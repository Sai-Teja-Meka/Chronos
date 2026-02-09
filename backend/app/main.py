"""
Project Chronos - Secured Main API
WITH SECURITY GUARDRAILS + ADVANCED MUTATION SUPPORT + SNAPSHOTS + SSE SUPPORT
"""

import os
import json
import logging
import asyncio
from typing import List, Optional, Dict, Any, AsyncGenerator
from uuid import UUID
from datetime import datetime

from fastapi import FastAPI, HTTPException, Depends, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor, execute_values

# Services
from app.services.branching import branching_service
from app.services.replay import ReplayEngine

# 🛡️ SECURITY IMPORTS
from app.core.security import (
    SecurityMiddleware,
    get_api_key,
    get_cors_origins,
    api_key_header,
    security_validator,
    api_key_manager,
    setup_rate_limiting 
)

from app.core.config import settings

PUBLIC_DEMO_MODE = os.getenv("PUBLIC_DEMO_MODE", "false").lower() == "true"

def demo_mode_block(reason: str = "This action is disabled in the public demo."):
    if PUBLIC_DEMO_MODE:
        raise HTTPException(status_code=403, detail=reason)
# --- CONFIGURATION & LOGGING ---

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("chronos.api")

app = FastAPI(
    title="Project Chronos API (Secured)",
    version="0.2.2",
    description="Time-Traveling Debugger for LLM Conversations with Security Guardrails"
)

# --- RATE LIMITING ---
setup_rate_limiting(app)

# --- SECURITY MIDDLEWARE ---
# ⚠️ CRITICAL: Add SecurityMiddleware BEFORE CORS
app.add_middleware(SecurityMiddleware)

# --- CORS MIDDLEWARE (with security) ---
cors_origins = get_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    max_age=3600,
)

# --- GLOBAL STATE ---
db_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None

# --- SSE INFRASTRUCTURE ---

class GraphUpdateBroadcaster:
    """
    Manages SSE connections and broadcasts graph updates to listeners.
    """
    def __init__(self):
        self._subscribers: Dict[str, asyncio.Queue] = {}
    
    def subscribe(self, client_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers[client_id] = q
        return q
    
    def unsubscribe(self, client_id: str):
        if client_id in self._subscribers:
            del self._subscribers[client_id]
    
    def broadcast(self, conversation_id: str, update_type: str, data: Dict[str, Any] = None):
        """Broadcasts an update event to all subscribers of a conversation."""
        message = {
            "type": update_type,
            "conversation_id": conversation_id,
            "timestamp": datetime.utcnow().isoformat(),
            "data": data or {}
        }
        
        # In a real production app, we would filter by conversation_id here.
        # For this implementation, we broadcast to all and let client filter or simple pub/sub.
        # To keep it simple and robust for now:
        dead_clients = []
        for client_id, q in self._subscribers.items():
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                dead_clients.append(client_id)
        
        for client_id in dead_clients:
            self.unsubscribe(client_id)

graph_broadcaster = GraphUpdateBroadcaster()

async def event_generator(request: Request, client_id: str) -> AsyncGenerator[str, None]:
    """
    Yields SSE events from the queue.
    """
    q = graph_broadcaster.subscribe(client_id)
    try:
        # Initial connection message
        yield f"data: {json.dumps({'type': 'connected'})}\n\n"

        while True:
            if await request.is_disconnected():
                break

            try:
                # Wait up to 15s for a message without blocking the event loop
                data = await asyncio.wait_for(q.get(), timeout=15.0)
                yield f"data: {json.dumps(data)}\n\n"
            except asyncio.TimeoutError:
                # Keep-alive comment
                yield ": keepalive\n\n"
    except Exception as e:
        logger.error(f"SSE Error: {e}")
    finally:
        graph_broadcaster.unsubscribe(client_id)

# --- LIFECYCLE EVENTS ---

@app.on_event("startup")
def startup_db_pool():
    """Initialize the connection pool on cold start."""
    global db_pool
    try:
        logger.info("🔄 Initializing PostgreSQL Connection Pool...")
        db_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=5,
            maxconn=20,
            dsn=settings.DATABASE_URL
        )
        logger.info("✅ Connection Pool initialized successfully.")
        
        if not os.getenv("CHRONOS_API_KEYS"):
            logger.error("🚨 SECURITY WARNING: No API keys configured!")
        else:
            logger.info("🛡️ Security guardrails ACTIVE")
            
    except Exception as e:
        logger.critical(f"❌ Failed to create DB pool: {e}")
        raise e

@app.on_event("shutdown")
def shutdown_db_pool():
    """Gracefully close all connections on shutdown."""
    global db_pool
    if db_pool:
        db_pool.closeall()
        logger.info("🔒 Connection Pool closed.")

# --- DATA MODELS ---

class EventSchema(BaseModel):
    event_id: UUID
    conversation_id: UUID
    parent_event_id: Optional[UUID]
    sequence_number: int
    event_type: str
    payload: Dict[str, Any]
    metadata: Dict[str, Any]
    created_at: datetime

class ReactFlowNode(BaseModel):
    id: str
    type: str = "chronosNode"
    data: Dict[str, Any]
    position: Dict[str, int]

class ReactFlowEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str = "smoothstep"
    animated: bool = False

class GraphResponse(BaseModel):
    nodes: List[ReactFlowNode]
    edges: List[ReactFlowEdge]

# 🎯 Advanced Mutation Modal Support
class AdvancedForkRequest(BaseModel):
    parent_event_id: UUID
    mutation_type: str = Field(..., pattern="^(user_message|system_message|assistant_message|tool_result)$")
    content: str
    tool_call_id: Optional[str] = None
    tool_name: Optional[str] = None
    model: str = "gpt-3.5-turbo"

class CompareRequest(BaseModel):
    branch_a_id: UUID
    branch_b_id: UUID

# --- DEPENDENCIES ---

def get_db_connection():
    """Yields a connection from the pool."""
    if not db_pool:
        raise HTTPException(status_code=503, detail="Database pool not initialized")
    
    conn = db_pool.getconn()
    try:
        yield conn
    finally:
        db_pool.putconn(conn)

# --- ENDPOINTS ---

# 🌍 PUBLIC ENDPOINTS

@app.get("/")
def read_root():
    """Public endpoint - API info"""
    return {
        "name": "Project Chronos API",
        "version": "0.2.2",
        "status": "secured",
        "docs": "/docs"
    }

@app.get("/health")
def health_check():
    """Public endpoint - Health check"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "database": "connected" if db_pool else "disconnected"
    }

# 🔐 SECURED ENDPOINTS

@app.post("/trace", status_code=201)
def ingest_events(
    events: List[EventSchema], 
    conn = Depends(get_db_connection),
    api_key: str = Depends(get_api_key)
):
    demo_mode_block()
    """🔐 SECURED: Receives buffered events from Interceptor."""
    start_time = datetime.now()
    
    # 🛡️ INPUT VALIDATION
    for event in events:
        security_validator.validate_event_type(event.event_type)
        security_validator.validate_json_size(event.payload, max_size_mb=1.0)
    
    query = """
    INSERT INTO events (
        event_id, conversation_id, parent_event_id, sequence_number, 
        event_type, payload, metadata, created_at
    ) VALUES %s
    ON CONFLICT (event_id) DO NOTHING;
    """
    
    values = [
        (
            str(e.event_id), str(e.conversation_id), 
            str(e.parent_event_id) if e.parent_event_id else None,
            e.sequence_number, e.event_type, 
            json.dumps(e.payload), json.dumps(e.metadata), e.created_at
        )
        for e in events
    ]

    try:
        with conn.cursor() as cur:
            execute_values(cur, query, values)
            actual_inserted = cur.rowcount
            conn.commit()
        
        duration = (datetime.now() - start_time).total_seconds() * 1000
        duplicates = len(events) - actual_inserted
        
        # 📡 BROADCAST UPDATE
        if actual_inserted > 0:
            conv_id = str(events[0].conversation_id)
            graph_broadcaster.broadcast(conv_id, "ingest", {"count": actual_inserted})

        logger.info(
            f"✅ Received {len(events)} events, inserted {actual_inserted}, "
            f"duplicates {duplicates} in {duration:.2f}ms"
        )
        
        return {
            "status": "success",
            "received": len(events),
            "inserted": actual_inserted,
            "duplicates": duplicates
        }
    except Exception as e:
        conn.rollback()
        logger.error(f"❌ Ingestion failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Database write failed")

@app.get("/trace/{conversation_id}", response_model=GraphResponse)
def get_conversation_graph(
    conversation_id: UUID,
    limit: int = Query(1000, le=5000),
    offset: int = 0,
    conn=Depends(get_db_connection),
    apikey: Optional[str] = Depends(api_key_header),  # optional
):
    if not PUBLIC_DEMO_MODE:
        # enforce normal auth
        # reuse your existing validator
        # (this calls the same logic as Depends(getapikey))
        if not api_key_manager.validate_key(apikey):
            raise HTTPException(status_code=401, detail="Invalid or missing API key")

    """🔐 SECURED: Returns graph topology (Raw Data Only)."""
    conversation_id_str = security_validator.validate_conversation_id(str(conversation_id))
    
    query = """
SELECT
  event_id,
  parent_event_id,
  sequence_number,
  event_type,
  payload,
  metadata,
  created_at
FROM events
WHERE conversation_id = %s
ORDER BY created_at ASC, sequence_number ASC
LIMIT %s OFFSET %s
"""
   
    nodes = []
    edges = []
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (conversation_id_str, limit, offset))
            rows = cur.fetchall()
            
            if not rows and offset == 0:
                raise HTTPException(status_code=404, detail="Conversation not found")

            for row in rows:
                node = ReactFlowNode(
                    id=str(row['event_id']),
                    type="chronosNode",
                    data={
                        "label": row['event_type'],
                        "payload": row['payload'],
                        "metadata": row['metadata'],
                        "sequence": row['sequence_number'],
                        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
                    },
                    position={"x": 0, "y": 0} 
                )
                nodes.append(node)
                
                if row['parent_event_id']:
                    edge = ReactFlowEdge(
                        id=f"e_{row['parent_event_id']}-{row['event_id']}",
                        source=str(row['parent_event_id']),
                        target=str(row['event_id'])
                    )
                    edges.append(edge)

        return GraphResponse(nodes=nodes, edges=edges)

    except Exception as e:
        logger.error(f"❌ Graph fetch failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/branch/fork", status_code=201)
def fork_conversation_endpoint(
    request: AdvancedForkRequest,
    api_key: str = Depends(get_api_key)
):
    demo_mode_block()
    """
    🔐 SECURED: Advanced Time Travel with Mutation Support.
    """
    security_validator.sanitize_string(request.content, max_length=10000)
    
    try:
        conversation_id = branching_service.fork_conversation_advanced(
            parent_event_id=request.parent_event_id,
            mutation_type=request.mutation_type,
            content=request.content,
            tool_call_id=request.tool_call_id,
            tool_name=request.tool_name,
            model=request.model
        )
        
        # 📡 BROADCAST UPDATE
        graph_broadcaster.broadcast(conversation_id, "fork", {"parent": str(request.parent_event_id)})
        
        return {
            "status": "success",
            "conversation_id": conversation_id,
            "mutation_type": request.mutation_type
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ Fork failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/branch/compare")
def compare_branches_endpoint(
    branch_a: UUID = Query(..., description="Tip Event ID of Branch A"),
    branch_b: UUID = Query(..., description="Tip Event ID of Branch B"),
    api_key: str = Depends(get_api_key)
):
    demo_mode_block()
    """🔐 SECURED: Compare two timelines."""
    try:
        return branching_service.compare_branches(branch_a, branch_b)
    except Exception as e:
        logger.error(f"❌ Comparison failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 📡 SSE ENDPOINT (NEW)
# ==========================================

@app.get("/stream/graph/{conversation_id}")
async def stream_graph_updates(
    conversation_id: str,
    request: Request
):
    """
    Real-time SSE stream for graph updates.
    Frontend connects here instead of polling.
    """
    import uuid
    client_id = str(uuid.uuid4())
    logger.info(f"🔌 SSE Client connected: {client_id} for {conversation_id}")
    
    return StreamingResponse(
        event_generator(request, client_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

# ==========================================
# 🔐 SECURED SNAPSHOT MANAGEMENT
# ==========================================

@app.post("/snapshots/create/{event_id}", status_code=201)
def create_snapshot(
    event_id: UUID, 
    conn = Depends(get_db_connection),
    api_key: str = Depends(get_api_key)
):
    """🔐 SECURED: Manually create a snapshot."""
    replay_engine = ReplayEngine(settings.DATABASE_URL, snapshot_interval=50)
    
    try:
        snapshot_id = replay_engine.create_snapshot(str(event_id))
        
        if snapshot_id:
            return {
                "status": "created",
                "snapshot_id": snapshot_id,
                "event_id": str(event_id)
            }
        else:
            return {
                "status": "exists",
                "message": "Snapshot already exists for this event",
                "event_id": str(event_id)
            }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"❌ Snapshot creation failed: {e}")
        raise HTTPException(status_code=500, detail="Snapshot creation failed")

@app.post("/snapshots/ensure/{conversation_id}", status_code=200)
def ensure_snapshots(
    conversation_id: UUID, 
    conn = Depends(get_db_connection),
    api_key: str = Depends(get_api_key)
):
    """🔐 SECURED: Ensures snapshots exist for optimization."""
    conversation_id_str = security_validator.validate_conversation_id(str(conversation_id))
    replay_engine = ReplayEngine(settings.DATABASE_URL, snapshot_interval=50)
    
    try:
        created_count = replay_engine.ensure_snapshots_for_conversation(conversation_id_str)
        return {
            "status": "success",
            "conversation_id": conversation_id_str,
            "snapshots_created": created_count,
            "message": f"Ensured snapshots for conversation (created {created_count} new)"
        }
    except Exception as e:
        logger.error(f"❌ Snapshot ensure failed: {e}")
        raise HTTPException(status_code=500, detail="Snapshot ensure failed")

@app.get("/snapshots/status/{conversation_id}")
def get_snapshot_status(
    conversation_id: UUID, 
    conn = Depends(get_db_connection),
    api_key: str = Depends(get_api_key)
):
    """🔐 SECURED: Get snapshot coverage status."""
    conversation_id_str = security_validator.validate_conversation_id(str(conversation_id))
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT COUNT(*) as total FROM events WHERE conversation_id = %s",
                (conversation_id_str,)
            )
            total_events = cur.fetchone()['total']
            
            cur.execute(
                """
                SELECT COUNT(DISTINCT s.snapshot_id) as count
                FROM snapshots s
                INNER JOIN events e ON s.event_id = e.event_id
                WHERE e.conversation_id = %s
                """,
                (conversation_id_str,)
            )
            snapshot_count = cur.fetchone()['count']
            
            cur.execute(
                """
                SELECT 
                    s.snapshot_id, s.event_id, s.event_count, s.created_at,
                    CASE WHEN s.state_datum::text = '[]' THEN false ELSE true END as is_populated
                FROM snapshots s
                INNER JOIN events e ON s.event_id = e.event_id
                WHERE e.conversation_id = %s
                ORDER BY s.event_count ASC
                """,
                (conversation_id_str,)
            )
            snapshots = cur.fetchall()
            
            expected_snapshots = (total_events // 50)
            coverage = (snapshot_count / expected_snapshots * 100) if expected_snapshots > 0 else 100
            
            return {
                "conversation_id": conversation_id_str,
                "total_events": total_events,
                "snapshot_count": snapshot_count,
                "expected_snapshots": expected_snapshots,
                "coverage_percent": round(coverage, 2),
                "snapshots": snapshots
            }
    except Exception as e:
        logger.error(f"❌ Snapshot status failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to get snapshot status")

@app.post("/snapshots/populate/{conversation_id}", status_code=200)
def populate_snapshots(
    conversation_id: UUID, 
    conn = Depends(get_db_connection),
    api_key: str = Depends(get_api_key)
):
    """🔐 SECURED: Populate empty snapshot placeholders."""
    conversation_id_str = security_validator.validate_conversation_id(str(conversation_id))
    replay_engine = ReplayEngine(settings.DATABASE_URL, snapshot_interval=50)
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT s.event_id
                FROM snapshots s
                INNER JOIN events e ON s.event_id = e.event_id
                WHERE e.conversation_id = %s AND s.state_datum::text = '[]'
                """,
                (conversation_id_str,)
            )
            placeholders = cur.fetchall()
        
        populated = 0
        for row in placeholders:
            event_id = str(row['event_id'])
            state = replay_engine.fold_state(event_id)
            
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE snapshots SET state_datum = %s WHERE event_id = %s",
                    (json.dumps(state), event_id)
                )
                conn.commit()
            populated += 1
        
        return {
            "status": "success",
            "conversation_id": conversation_id_str,
            "populated": populated
        }
    except Exception as e:
        logger.error(f"❌ Snapshot population failed: {e}")
        raise HTTPException(status_code=500, detail="Snapshot population failed")

# --- ADMIN ENDPOINTS ---

@app.post("/admin/generate-key")
def generate_api_key(admin_password: str = Query(...)):
    demo_mode_block()
    """🔐 ADMIN: Generate a new API key."""
    expected_password = os.getenv("CHRONOS_ADMIN_PASSWORD")
    
    if not expected_password:
        raise HTTPException(status_code=503, detail="Admin password not configured")
    
    if admin_password != expected_password:
        logger.warning("❌ Invalid admin password attempt")
        raise HTTPException(status_code=401, detail="Invalid admin password")
    
    new_key = api_key_manager.generate_key()
    logger.info(f"✅ Generated new API key: {new_key[:20]}...")
    
    return {
        "api_key": new_key,
        "note": "Add this to CHRONOS_API_KEYS environment variable"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)