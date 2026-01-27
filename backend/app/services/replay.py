import uuid
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import List, Dict, Any, Optional, Union
import logging

logger = logging.getLogger("chronos.replay")

class ReplayEngine:
    def __init__(self, db_connection_string: str, snapshot_interval: int = 50):
        """
        Initialize ReplayEngine with snapshot optimization.
        
        Args:
            db_connection_string: PostgreSQL connection string
            snapshot_interval: Create snapshot every N events (default: 50)
        """
        self.conn_str = db_connection_string
        self.snapshot_interval = snapshot_interval

    def fold_state(self, target_event_id: str) -> List[Dict]:
        logger.info(f"Replaying state to event {target_event_id}")
        
        # 1. Try snapshot-optimized path
        snapshot = self._find_closest_snapshot(target_event_id)
        
        if snapshot:
            # [Existing Snapshot Logic - Unchanged]
            logger.info(f"Using snapshot from event {snapshot['event_id']}")
            messages_state = json.loads(snapshot['state_datum'])
            snapshot_event_id = snapshot['event_id']
            delta_events = self._fetch_events_after_snapshot(snapshot_event_id, target_event_id)
            for event in delta_events:
                self._apply_event(messages_state, event)
            return messages_state

        else:
            # 2. Full lineage traversal (fallback)
            logger.warning(f"No snapshot found, using full lineage traversal")
            
            lineage = self._fetch_lineage(target_event_id)
            if not lineage:
                raise ValueError(f"Event {target_event_id} not found.")

            # 🛡️ NEW: LINEAGE INTEGRITY CHECK
            # The query orders by depth DESC, so index 0 is the furthest ancestor found.
            root_found = lineage[0]
            if root_found['parent_event_id'] is not None:
                # If the 'root' has a parent, but that parent isn't in the list, 
                # it means the recursive query hit a dead end (missing data).
                error_msg = (
                    f"⚠️ BROKEN CHAIN DETECTED: Lineage ends at event {root_found['event_id']} "
                    f"which expects parent {root_found['parent_event_id']}, but it is missing."
                )
                logger.error(error_msg)
                
                # RECOVERY STRATEGY: 
                # We inject a system warning so the LLM knows context is missing.
                messages_state: List[Dict] = [{
                    "role": "system",
                    "content": "[SYSTEM WARNING: Previous conversation history has been lost due to a system error. Treat this as the start of the context.]"
                }]
            else:
                messages_state = []

            for event in lineage:
                self._apply_event(messages_state, event)
                
            return messages_state

    def create_snapshot(self, event_id: str) -> Optional[str]:
        """
        Creates a snapshot of the conversation state at the given event.
        
        Args:
            event_id: Event to snapshot
            
        Returns:
            snapshot_id if created, None if already exists
        """
        # Check if snapshot already exists
        with psycopg2.connect(self.conn_str) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT snapshot_id FROM snapshots WHERE event_id = %s",
                    (event_id,)
                )
                if cur.fetchone():
                    logger.debug(f"Snapshot already exists for event {event_id}")
                    return None
        
        # Reconstruct state (will use existing snapshots if available)
        try:
            state = self.fold_state(event_id)
        except ValueError:
            logger.error(f"Cannot create snapshot: event {event_id} not found")
            return None
        
        # Count events in this lineage
        lineage = self._fetch_lineage(event_id)
        event_count = len(lineage)
        
        # Save snapshot
        snapshot_id = str(uuid.uuid4())
        with psycopg2.connect(self.conn_str) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO snapshots (snapshot_id, event_id, state_datum, event_count)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (event_id) DO NOTHING
                    RETURNING snapshot_id
                    """,
                    (snapshot_id, event_id, json.dumps(state), event_count)
                )
                result = cur.fetchone()
                conn.commit()
                
                if result:
                    logger.info(f"Created snapshot {snapshot_id} for event {event_id} ({event_count} events)")
                    return snapshot_id
                else:
                    logger.debug(f"Snapshot already existed for event {event_id}")
                    return None

    def ensure_snapshots_for_conversation(self, conversation_id: str) -> int:
        """
        Ensures snapshots exist for a conversation at appropriate intervals.
        Creates snapshots every snapshot_interval events.
        
        Args:
            conversation_id: Conversation to snapshot
            
        Returns:
            Number of snapshots created
        """
        # Get all events in conversation ordered by sequence
        with psycopg2.connect(self.conn_str) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT event_id, sequence_number 
                    FROM events 
                    WHERE conversation_id = %s 
                    ORDER BY sequence_number ASC
                    """,
                    (conversation_id,)
                )
                events = cur.fetchall()
        
        if not events:
            logger.warning(f"No events found for conversation {conversation_id}")
            return 0
        
        # Determine which events should have snapshots
        snapshot_points = []
        for i, event in enumerate(events):
            # Create snapshot every snapshot_interval events
            if (i + 1) % self.snapshot_interval == 0:
                snapshot_points.append(event['event_id'])
        
        # Create snapshots
        created = 0
        for event_id in snapshot_points:
            if self.create_snapshot(event_id):
                created += 1
        
        logger.info(f"Ensured {len(snapshot_points)} snapshots for conversation {conversation_id} ({created} created)")
        return created

    # ==========================================
    # PRIVATE METHODS - Snapshot Queries
    # ==========================================

    def _find_closest_snapshot(self, target_event_id: str) -> Optional[Dict]:
        """
        Finds the closest snapshot that is an ancestor of the target event.
        Uses the materialized path to efficiently find ancestors.
        """
        query = """
        SELECT s.snapshot_id, s.event_id, s.state_datum, s.event_count, s.created_at
        FROM snapshots s
        INNER JOIN events e ON s.event_id = e.event_id
        WHERE e.event_id = ANY(
            SELECT unnest(path) FROM events WHERE event_id = %s
        )
        ORDER BY s.event_count DESC
        LIMIT 1
        """
        
        with psycopg2.connect(self.conn_str) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, (target_event_id,))
                return cur.fetchone()

    def _fetch_events_after_snapshot(self, snapshot_event_id: str, target_event_id: str) -> List[Dict]:
        """
        Fetches events between snapshot and target (exclusive of snapshot, inclusive of target).
        Only fetches events on the path from snapshot to target.
        """
        query = """
        WITH RECURSIVE path_to_target AS (
            -- Base: Start at target
            SELECT event_id, parent_event_id, sequence_number, event_type, payload, metadata, 0 as depth
            FROM events
            WHERE event_id = %s
            
            UNION ALL
            
            -- Recurse: Walk to parent
            SELECT e.event_id, e.parent_event_id, e.sequence_number, e.event_type, e.payload, e.metadata, p.depth + 1
            FROM events e
            INNER JOIN path_to_target p ON e.event_id = p.parent_event_id
            WHERE e.event_id != %s  -- Stop at snapshot (exclusive)
        )
        SELECT * FROM path_to_target 
        ORDER BY depth DESC, sequence_number ASC
        """
        
        with psycopg2.connect(self.conn_str) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, (target_event_id, snapshot_event_id))
                return cur.fetchall()

    # ==========================================
    # EXISTING METHODS (Unchanged)
    # ==========================================

    def _fetch_lineage(self, target_uuid: str) -> List[Dict]:
        """
        SQL FIX #1: Added 'depth' column and proper ordering.
        Recursive query walks UP from Target to Root, assigning increasing depth.
        Final select orders by depth DESC (Root first) then sequence (for parallel stability).
        """
        query = """
        WITH RECURSIVE branch_lineage AS (
            -- Base case: The target event (Depth 0)
            SELECT event_id, parent_event_id, sequence_number, event_type, payload, metadata, 0 as depth
            FROM events
            WHERE event_id = %s
            
            UNION ALL
            
            -- Recursive step: Walk to Parent (Depth + 1)
            SELECT e.event_id, e.parent_event_id, e.sequence_number, e.event_type, e.payload, e.metadata, bl.depth + 1
            FROM events e
            INNER JOIN branch_lineage bl ON e.event_id = bl.parent_event_id
        )
        -- Order by Depth DESC (Root has highest depth number in this bottom-up logic)
        -- Secondary sort by sequence_number ensures stability.
        SELECT * FROM branch_lineage ORDER BY depth DESC, sequence_number ASC;
        """
        
        with psycopg2.connect(self.conn_str) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, (target_uuid,))
                return cur.fetchall()

    def _apply_event(self, state: List[Dict], event: Dict):
        """Reduces an OTel event into the OpenAI state."""
        etype = event['event_type']
        payload = event['payload']
        
        # TRANSFORMATION FIX #1: System Message Handler
        if etype == 'system_message':
            content = self._extract_text_content(payload.get('gen_ai.input.messages', []))
            state.append({"role": "system", "content": content})

        elif etype == 'user_message':
            content = self._extract_text_content(payload.get('gen_ai.input.messages', []))
            state.append({"role": "user", "content": content})

        elif etype == 'assistant_message':
            content = self._extract_text_content(payload.get('gen_ai.output.messages', []))
            state.append({"role": "assistant", "content": content})

        elif etype == 'tool_call':
            output_msgs = payload.get('gen_ai.output.messages', [])
            if not output_msgs: return

            openai_tool_calls = []
            parts = output_msgs[0].get('parts', [])
            
            for part in parts:
                if part.get('type') == 'tool_use':
                    # TRANSFORMATION FIX #2: Safe Argument Serialization
                    raw_args = part.get('arguments', {})
                    if isinstance(raw_args, (dict, list)):
                        safe_args = json.dumps(raw_args)
                    else:
                        safe_args = str(raw_args) if raw_args is not None else "{}"

                    openai_tool_calls.append({
                        "id": part.get('id'),
                        "type": "function",
                        "function": {
                            "name": part.get('name'),
                            "arguments": safe_args
                        }
                    })
            
            state.append({
                "role": "assistant",
                "content": None,
                "tool_calls": openai_tool_calls
            })

        elif etype == 'tool_result':
            input_msgs = payload.get('gen_ai.input.messages', [])
            if not input_msgs: return
            
            parts = input_msgs[0].get('parts', [])
            for part in parts:
                if part.get('type') == 'tool_result':
                    # TRANSFORMATION FIX #3: Content Serialization
                    raw_content = part.get('content')
                    if isinstance(raw_content, (dict, list)):
                        safe_content = json.dumps(raw_content)
                    else:
                        safe_content = str(raw_content) if raw_content is not None else ""

                    state.append({
                        "role": "tool",
                        "tool_call_id": part.get('id'),
                        "content": safe_content
                    })

        # Explicit Handlers for non-context events
        elif etype == 'error':
            # Errors generally don't modify the context window for re-execution,
            # but we log it implicitly by not appending to 'state'.
            pass

        elif etype == 'branch_create':
            # Structural event; does not contain message content.
            pass

    def _extract_text_content(self, messages: List[Dict]) -> str:
        """TRANSFORMATION FIX #4: Safe Text Extraction"""
        if not messages: return ""
        parts = messages[0].get('parts', [])
        # Handle 'content' vs 'text' key variance safely
        return "".join([
            p.get('text', p.get('content', '')) 
            for p in parts 
            if p.get('type') == 'text'
        ])