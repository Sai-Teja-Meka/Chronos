import os
import uuid
import json
import logging
import threading
import time
import copy  # 🟢 ADDED: Required for deep copy fix
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime

# Dependencies
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from openai import OpenAI

from app.services.replay import ReplayEngine
from app.core.config import settings

logger = logging.getLogger("chronos.branching")

class BranchingService:
    def __init__(self):
        self.db_dsn = settings.DATABASE_URL
        self.replay_engine = ReplayEngine(self.db_dsn, snapshot_interval=50)
        
        # Strict API Key Validation
        self.openai_client = None
        openai_key = os.getenv("OPENAI_API_KEY")
        if openai_key:
            if not openai_key.startswith("sk-"):
                raise ValueError(
                    "CRITICAL: Invalid OPENAI_API_KEY format. "
                    "Key must start with 'sk-'."
                )
            self.openai_client = OpenAI(api_key=openai_key)

        # Claude key (required only if a Claude model is requested)
        self.anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    def _is_claude_model(self, model: str) -> bool:
        return model.startswith("claude-")

    def _call_claude_messages(self, model: str, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not self.anthropic_key:
            raise ValueError("ANTHROPIC_API_KEY is missing. Set it to run Claude models.")
        
        # Convert OpenAI-style messages to Claude Messages API shape (minimal text-only)
        claude_messages = []
        system_text = None
        
        for m in messages:
            role = m.get("role")
            if role == "system":
                # Claude supports a top-level system string; keep last system message
                system_text = m.get("content") or ""
            elif role in ("user", "assistant"):
                claude_messages.append({"role": role, "content": m.get("content") or ""})
            # NOTE: tool role/tool_calls not supported in this minimal version
            
        payload: Dict[str, Any] = {
            "model": model,
            "max_tokens": 1024,
            "messages": claude_messages,
        }

        if system_text:
            payload["system"] = system_text

        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": self.anthropic_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=payload,
            timeout=60,
        )
        r.raise_for_status()
        return r.json()

    # Add this to branching.py - Enhanced fork_conversation method
    def fork_conversation_advanced(
        self, 
        parent_event_id: uuid.UUID, 
        mutation_type: str,
        content: str,
        tool_call_id: Optional[str] = None,
        tool_name: Optional[str] = None,
        model: str = "gpt-3.5-turbo"
    ) -> str:
        """
        Creates a new timeline branch with advanced mutation support.
        
        Supports:
        - user_message: Standard user input
        - system_message: Modify system instructions
        - assistant_message: Force specific assistant response
        - tool_result: Simulate tool execution results
        
        This allows testing "What If" scenarios like:
        - "What if system prompt was different?"
        - "What if database returned 0 results?"
        - "What if API call failed?"
        """
        
        # 1. Fetch Context
        context_meta = self._get_event_metadata(parent_event_id)
        if not context_meta:
            raise ValueError(f"Parent event {parent_event_id} not found")
        
        conversation_id = context_meta['conversation_id']
        parent_seq = context_meta['sequence_number']
        
        # 2. Reconstruct History up to parent
        history = self.replay_engine.fold_state(str(parent_event_id))
        
        # 3. Create mutation event based on type
        now = datetime.utcnow().isoformat() + "Z"
        mutation_event_id = str(uuid.uuid4())
        provider = "anthropic" if self._is_claude_model(model) else "openai"

        if mutation_type == 'user_message':
            # Standard user message
            mutation_event = {
                'event_id': mutation_event_id,
                'conversation_id': str(conversation_id),
                'parent_event_id': str(parent_event_id),
                'sequence_number': parent_seq + 1,
                'event_type': 'user_message',
                'payload': {
                    'gen_ai.provider.name': provider,
                    'gen_ai.operation.name': 'chat',
                    'gen_ai.input.messages': [{
                        'role': 'user',
                        'parts': [{'type': 'text', 'text': content}]
                    }]
                },
                'metadata': {
  'mutation': True,
  'mutation_type': 'user_message',
  'gen_ai.model': model,
  'gen_ai.provider.name': 'anthropic' if self._is_claude_model(model) else 'openai',
},

                'created_at': now
            }
            
            # Append to history for LLM call
            new_messages = history + [{"role": "user", "content": content}]
            
        elif mutation_type == 'system_message':
            # System prompt mutation
            mutation_event = {
                'event_id': mutation_event_id,
                'conversation_id': str(conversation_id),
                'parent_event_id': str(parent_event_id),
                'sequence_number': parent_seq + 1,
                'event_type': 'system_message',
                'payload': {
                    'gen_ai.provider.name': provider,
                    'gen_ai.operation.name': 'chat',
                    'gen_ai.input.messages': [{
                        'role': 'system',
                        'parts': [{'type': 'text', 'text': content}]
                    }]
                },
                'metadata': {
  'mutation': True,
  'mutation_type': 'system_message',  
  'gen_ai.model': model,
  'gen_ai.provider.name': 'anthropic' if self._is_claude_model(model) else 'openai',
},
                'created_at': now
            }
            
            # Replace or add system message at start
            new_messages = [{"role": "system", "content": content}]
            # Add rest of history (excluding old system message if present)
            new_messages += [msg for msg in history if msg.get('role') != 'system']
            
        elif mutation_type == 'assistant_message':
            # Force specific assistant response
            mutation_event = {
                'event_id': mutation_event_id,
                'conversation_id': str(conversation_id),
                'parent_event_id': str(parent_event_id),
                'sequence_number': parent_seq + 1,
                'event_type': 'assistant_message',
                'payload': {
                    'gen_ai.provider.name': provider,
                    'gen_ai.operation.name': 'chat',
                    'gen_ai.output.messages': [{
                        'role': 'assistant',
                        'finish_reason': 'stop',
                        'parts': [{'type': 'text', 'text': content}]
                    }]
                },
                'metadata': {'mutation': True, 'gen_ai.model': model, 'mutation_type': 'assistant_message'},
                'created_at': now
            }
            
            # Insert event but don't call LLM (we're forcing the response)
            self._insert_events([mutation_event])
            return str(conversation_id)
            
        elif mutation_type == 'tool_result':
            # Simulate tool execution result
            if not tool_call_id:
                raise ValueError("tool_call_id required for tool_result mutation")
            
            if self._is_claude_model(model):
                raise ValueError("tool_result forks are not supported for Claude yet (needs tool_use/tool_result mapping).")
            
            # CRITICAL FIX: OpenAI requires a tool_call message BEFORE tool_result
            # We need to inject a fake tool_call first, then the tool_result
            
            # Step 1: Create fake tool_call event
            tool_call_event_id = str(uuid.uuid4())
            tool_call_event = {
                'event_id': tool_call_event_id,
                'conversation_id': str(conversation_id),
                'parent_event_id': str(parent_event_id),
                'sequence_number': parent_seq + 1,
                'event_type': 'tool_call',
                'payload': {
                    'gen_ai.operation.name': 'chat',
                    'gen_ai.provider.name': 'anthropic' if self._is_claude_model(model) else 'openai',
                    'gen_ai.tool.name': tool_name or 'simulated_tool',
                    'gen_ai.output.messages': [{
                        'role': 'assistant',
                        'finish_reason': 'tool_calls',
                        'parts': [{
                            'type': 'tool_use',
                            'id': tool_call_id,
                            'name': tool_name or 'simulated_tool',
                            'arguments': {}  # Empty arguments for simulated call
                        }]
                    }]
                },
                'metadata': {
                    'mutation': True,
                    'mutation_type': 'tool_call_injected',
                    'injected_for_tool_result': True,
                    'gen_ai.model': model,
                    'gen_ai.provider.name': 'anthropic' if self._is_claude_model(model) else 'openai',
                },
                'created_at': now
            }
            
            # Step 2: Create tool_result event (child of tool_call)
            mutation_event = {
                'event_id': mutation_event_id,
                'conversation_id': str(conversation_id),
                'parent_event_id': tool_call_event_id,  # Parent is the injected tool_call
                'sequence_number': parent_seq + 2,  # One step after tool_call
                'event_type': 'tool_result',
                'payload': {
                    'gen_ai.provider.name': provider,
                    'gen_ai.operation.name': 'execute_tool',
                    'gen_ai.tool.call.id': tool_call_id,
                    'gen_ai.tool.name': tool_name or 'simulated_tool',
                    'gen_ai.input.messages': [{
                        'role': 'tool',
                        'parts': [{
                            'type': 'tool_result',
                            'id': tool_call_id,
                            'content': content
                        }]
                    }]
                },
                'metadata': {
                    'mutation': True, 
                    'mutation_type': 'tool_result',
                    'status': 'simulated',
                    'gen_ai.model': model,
                    'gen_ai.provider.name': 'anthropic' if self._is_claude_model(model) else 'openai',
                },
                'created_at': now
            }
            
            # Append BOTH tool_call and tool_result to history
            # 🛡️ SECURITY FIX: Deep copy history to prevent mutation of shared state
            new_messages = copy.deepcopy(history) + [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": tool_name or 'simulated_tool',
                            "arguments": "{}"
                        }
                    }]
                },
                {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": content
                }
            ]
            
            # Mark that we need to insert TWO events (tool_call + tool_result)
            events_to_insert = [tool_call_event, mutation_event]
        
        # 4. For messages that trigger LLM response, call OpenAI
        if mutation_type in ['user_message', 'system_message', 'tool_result']:
            logger.info(f"Forking conversation with {mutation_type} mutation")
            
            try:
                t0 = time.time()
                assistant_text = ""
                finish_reason = "stop"
                usage_in = 0
                usage_out = 0

                if self._is_claude_model(model):
                    provider = "anthropic"
                    data = self._call_claude_messages(model, new_messages)
                    # Claude content is a list of blocks; join text blocks
                    content_blocks = data.get("content", [])
                    assistant_text = "".join(
                        b.get("text", "") for b in content_blocks if b.get("type") == "text"
                    )
                    # Best-effort fields (may vary)
                    finish_reason = data.get("stop_reason") or "stop"
                    usage = data.get("usage") or {}
                    usage_in = usage.get("input_tokens", 0) or 0
                    usage_out = usage.get("output_tokens", 0) or 0
                else:
                    if not self.openai_client:
                        raise ValueError("OPENAI_API_KEY is missing but an OpenAI model was requested.")
                    response = self.openai_client.chat.completions.create(
                        model=model,
                        messages=new_messages,
                        stream=False
                    )
                    assistant_text = response.choices[0].message.content
                    finish_reason = response.choices[0].finish_reason
                    usage_in = response.usage.prompt_tokens
                    usage_out = response.usage.completion_tokens
                
                latency_ms = int((time.time() - t0) * 1000)
                
                # Create assistant response event
                assistant_event_id = str(uuid.uuid4())
                assistant_event = {
                    'event_id': assistant_event_id,
                    'conversation_id': str(conversation_id),
                    # CRITICAL: Parent depends on mutation type
                    'parent_event_id': mutation_event_id if mutation_type != 'tool_result' else mutation_event_id,  # For tool_result, parent is the tool_result event
                    'sequence_number': parent_seq + 2 if mutation_type != 'tool_result' else parent_seq + 3,  # tool_result needs +3 (call, result, assistant)
                    'event_type': 'assistant_message',
                    'payload': {
                        'gen_ai.provider.name': provider,
                        'gen_ai.operation.name': 'chat',
                        'gen_ai.output.messages': [{
                            'role': 'assistant',
                            'finish_reason': finish_reason,
                            'parts': [{'type': 'text', 'text': assistant_text}]
                        }]
                    },
                    'metadata': {
                        'gen_ai.model': model,
                        'gen_ai.provider.name': provider,
                        'gen_ai.usage.input_tokens': usage_in,
                        'gen_ai.usage.output_tokens': usage_out,
                        'latency_ms': latency_ms,
                        'in_response_to_mutation': True
                    },
                    'created_at': now
                }
                
                # Insert events (handle tool_result special case with 3 events)
                if mutation_type == 'tool_result':
                    # Insert: tool_call, tool_result, assistant_response
                    self._insert_events(events_to_insert + [assistant_event])
                else:
                    # Insert: mutation, assistant_response
                    self._insert_events([mutation_event, assistant_event])
                
                return str(conversation_id)
                
            except Exception as e:
                logger.error(f"Mutation branching failed: {e}")
                raise e
        
        # Should not reach here
        return str(conversation_id)

    def compare_branches(self, tip_a_id: uuid.UUID, tip_b_id: uuid.UUID) -> Dict[str, Any]:
        """
        Compares two distinct timeline branches.
        """
        lineage_a = self.replay_engine._fetch_lineage(str(tip_a_id))
        lineage_b = self.replay_engine._fetch_lineage(str(tip_b_id))
        
        def extract_metrics(lineage):
            tokens = 0
            latency = 0.0
            for event in lineage:
                meta = event.get('metadata', {})
                # FIX: Use correct metadata key
                latency += meta.get('latency_ms', 0) or 0
                
                # Token counting from payload instead of metadata
                payload = event.get('payload', {})
                output_msgs = payload.get('gen_ai.output.messages', [])
                for msg in output_msgs:
                    for part in msg.get('parts', []):
                        if part.get('type') == 'text' and part.get('text'):
                            # Rough token estimate: ~4 chars per token
                            tokens += len(part['text']) // 4
            
            return {"tokens": tokens, "latency": latency, "steps": len(lineage)}

        metrics_a = extract_metrics(lineage_a)
        metrics_b = extract_metrics(lineage_b)
        
        return {
            "branch_a": {"id": str(tip_a_id), **metrics_a},
            "branch_b": {"id": str(tip_b_id), **metrics_b},
            "diff": {
                "token_delta": metrics_b['tokens'] - metrics_a['tokens'],
                "latency_delta_ms": metrics_b['latency'] - metrics_a['latency']
            }
        }

    # --- HELPERS ---

    def _get_event_metadata(self, event_id: uuid.UUID) -> Optional[Dict]:
        conn = psycopg2.connect(self.db_dsn)
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT conversation_id, sequence_number FROM events WHERE event_id = %s", 
                    (str(event_id),)
                )
                return cur.fetchone()
        finally:
            conn.close()

    def _insert_events(self, events: List[Dict]):
        conn = psycopg2.connect(self.db_dsn)
        try:
            query = """
            INSERT INTO events (
                event_id, conversation_id, parent_event_id, sequence_number, 
                event_type, payload, metadata, created_at
            ) VALUES %s
            ON CONFLICT (event_id) DO NOTHING;
            """
            values = [
                (
                    e['event_id'], e['conversation_id'], e['parent_event_id'],
                    e['sequence_number'], e['event_type'], 
                    json.dumps(e['payload']), json.dumps(e['metadata']), e['created_at']
                )
                for e in events
            ]
            with conn.cursor() as cur:
                execute_values(cur, query, values)
                conn.commit()
        finally:
            conn.close()

branching_service = BranchingService()