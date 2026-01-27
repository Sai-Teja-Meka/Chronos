from uuid import UUID
from typing import Dict, Any, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class EventSchema(BaseModel):
    """
    Represents a single atomic event in the system.
    Matches the Python Interceptor's buffer format.
    """
    event_id: UUID
    conversation_id: UUID
    parent_event_id: Optional[UUID] = None
    sequence_number: int = Field(ge=0, description="Logical clock for ordering")
    event_type: str = Field(..., description="user_message, assistant_message, tool_call, etc.")
    payload: Dict[str, Any] = Field(default_factory=dict, description="OTel v1.37+ compliant data")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Telemetry (tokens, latency)")
    created_at: datetime

class ReactFlowNode(BaseModel):
    """
    Frontend representation of a graph node.
    Compatible with ReactFlow 'nodes' prop.
    """
    id: str
    type: str = "chronosNode"  # Maps to ChronosNode.tsx
    data: Dict[str, Any]
    position: Dict[str, int]

class ReactFlowEdge(BaseModel):
    """
    Frontend representation of a graph connection.
    Compatible with ReactFlow 'edges' prop.
    """
    id: str
    source: str
    target: str
    type: str = "smoothstep"
    animated: bool = False

class GraphResponse(BaseModel):
    """
    The full topology payload for the Visualization Layer.
    """
    nodes: List[ReactFlowNode]
    edges: List[ReactFlowEdge]