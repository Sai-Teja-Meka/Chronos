import requests
import json
from uuid import uuid4
from datetime import datetime, timedelta

# Your AWS backend
API_BASE = "http://100.49.115.68"
API_KEY = "chronos_demo_key_12345"

# Generate conversation ID
conv_id = str(uuid4())
print(f"📝 Conversation ID: {conv_id}")

# Helper to create events
def create_event(event_id, parent_id, seq, event_type, content, metadata=None):
    return {
        "event_id": event_id,
        "conversation_id": conv_id,
        "parent_event_id": parent_id,
        "sequence_number": seq,
        "event_type": event_type,
        "payload": {"content": content},
        "metadata": metadata or {"source": "demo"},
        "created_at": (datetime.utcnow() + timedelta(seconds=seq)).isoformat() + "Z"
    }

# === ORIGINAL TIMELINE ===
e1 = str(uuid4())  # User: "How do I debug LLM failures?"
e2 = str(uuid4())  # Assistant: "Try Chronos for time-travel debugging"
e3 = str(uuid4())  # Tool call: search("chronos debugging")
e4 = str(uuid4())  # Tool result: Found docs
e5 = str(uuid4())  # Assistant: "Here's how to use it..."

# === FORK POINT (e2) ===
e6 = str(uuid4())  # Branch A: User: "Tell me about event sourcing approach"
e7 = str(uuid4())  # Branch A: Assistant explains event sourcing
e8 = str(uuid4())  # Branch B: User: "Tell me about snapshot optimization"
e9 = str(uuid4())  # Branch B: Assistant explains snapshots

events = [
    # Main timeline
    create_event(e1, None, 1, "user_message", "How do I debug LLM application failures?"),
    create_event(e2, e1, 2, "assistant_message", "I recommend using Chronos - it's an event-sourced debugger that lets you rewind conversations and fork timelines to test different approaches."),
    create_event(e3, e2, 3, "tool_call", json.dumps({"name": "web_search", "arguments": {"query": "chronos llm debugger documentation"}}), {"tool_call_id": "call_123"}),
    create_event(e4, e3, 4, "tool_result", json.dumps({"result": "Chronos captures every LLM interaction as immutable events, enabling time-travel debugging and branch comparison."}), {"tool_call_id": "call_123"}),
    create_event(e5, e4, 5, "assistant_message", "Based on the docs: Chronos works by capturing events (messages, tool calls, errors) and storing them in PostgreSQL. You can rewind to any point, fork alternative timelines, and compare branches using Arena metrics."),
    
    # Branch A: Event Sourcing Deep Dive
    create_event(e6, e2, 6, "user_message", "[FORK A] Tell me more about the event sourcing architecture"),
    create_event(e7, e6, 7, "assistant_message", "Event sourcing means every state change is stored as an immutable event. In Chronos, each message/tool call/error is an event with parent_event_id creating a DAG. This lets you replay history, fork timelines, and compare 'what-if' scenarios without losing the original conversation."),
    
    # Branch B: Snapshot Optimization Deep Dive
    create_event(e8, e2, 8, "user_message", "[FORK B] Tell me about the snapshot optimization system"),
    create_event(e9, e8, 9, "assistant_message", "Chronos uses snapshots to avoid replaying 1000s of events. Every 50 events, it creates a checkpoint with the full conversation state. When you time-travel, it loads the nearest snapshot and replays only the delta. This keeps retrieval under 200ms even for long conversations."),
]

# Send to backend
response = requests.post(
    f"{API_BASE}/trace",
    json=events,
    headers={"X-API-Key": API_KEY, "Content-Type": "application/json"}
)

if response.status_code == 201:
    print(f"✅ Demo trace created successfully!")
    print(f"📊 {response.json()}")
    print(f"\n🔗 View in UI: http://your-vercel-app.vercel.app?conversation={conv_id}")
    print(f"🔗 Test API: {API_BASE}/trace/{conv_id}")
else:
    print(f"❌ Failed: {response.status_code} - {response.text}")
