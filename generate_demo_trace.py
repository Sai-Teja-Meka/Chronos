import requests
import json
from uuid import uuid4
from datetime import datetime, timedelta

# Your AWS backend
API_BASE = "https://chronos.rayray.hk"
API_KEY = "chronos_demo_key_12345"

# Generate conversation ID
conv_id = str(uuid4())
print(f"📝 Conversation ID: {conv_id}")

# Helper to create OTel-formatted events
def create_event(event_id, parent_id, seq, event_type, content, metadata=None, tool_name=None, tool_result=None):
    base_metadata = metadata or {"source": "demo"}
    
    # Format payload based on event type
    if event_type == "user_message":
        payload = {
            "gen_ai.input.messages": [{
                "role": "user",
                "parts": [{"type": "text", "text": content}]
            }]
        }
    elif event_type == "assistant_message":
        payload = {
            "gen_ai.output.messages": [{
                "role": "assistant",
                "parts": [{"type": "text", "text": content}]
            }]
        }
        base_metadata["gen_ai.usage.output_tokens"] = len(content.split())
    elif event_type == "tool_call":
        payload = {
            "gen_ai.output.messages": [{
                "role": "assistant",
                "parts": [{
                    "type": "tool_use",
                    "name": tool_name or "search",
                    "id": f"call_{seq}",
                    "arguments": json.loads(content) if isinstance(content, str) else content
                }]
            }]
        }
    elif event_type == "tool_result":
        payload = {
            "gen_ai.input.messages": [{
                "role": "user",
                "parts": [{
                    "type": "tool_result",
                    "id": f"call_{seq-1}",
                    "content": tool_result or content
                }]
            }]
        }
    else:
        payload = {"content": content}
    
    return {
        "event_id": event_id,
        "conversation_id": conv_id,
        "parent_event_id": parent_id,
        "sequence_number": seq,
        "event_type": event_type,
        "payload": payload,
        "metadata": base_metadata,
        "created_at": (datetime.utcnow() + timedelta(seconds=seq)).isoformat() + "Z"
    }

# === CREATE DEMO CONVERSATION ===
e1 = str(uuid4())  # User asks about debugging
e2 = str(uuid4())  # Assistant suggests Chronos
e3 = str(uuid4())  # Tool call: search
e4 = str(uuid4())  # Tool result
e5 = str(uuid4())  # Assistant explains based on docs

# Fork points
e6 = str(uuid4())  # Branch A: Event sourcing question
e7 = str(uuid4())  # Branch A: Answer
e8 = str(uuid4())  # Branch B: Snapshots question
e9 = str(uuid4())  # Branch B: Answer

events = [
    # Main timeline
    create_event(e1, None, 1, "user_message", 
        "How do I debug LLM application failures?"),
    
    create_event(e2, e1, 2, "assistant_message",
        "I recommend using Chronos - it's an event-sourced debugger that lets you rewind conversations and fork timelines to test different approaches."),
    
    create_event(e3, e2, 3, "tool_call",
        json.dumps({"query": "chronos llm debugger documentation"}),
        tool_name="web_search"),
    
    create_event(e4, e3, 4, "tool_result",
        "Search results",
        tool_result="Chronos captures every LLM interaction as immutable events, enabling time-travel debugging and branch comparison."),
    
    create_event(e5, e4, 5, "assistant_message",
        "Based on the docs: Chronos works by capturing events (messages, tool calls, errors) and storing them in PostgreSQL. You can rewind to any point, fork alternative timelines, and compare branches using Arena metrics."),
    
    # Branch A: Event Sourcing
    create_event(e6, e2, 6, "user_message",
        "[FORK A] Tell me more about the event sourcing architecture"),
    
    create_event(e7, e6, 7, "assistant_message",
        "Event sourcing means every state change is stored as an immutable event. In Chronos, each message/tool call/error is an event with parent_event_id creating a DAG. This lets you replay history, fork timelines, and compare 'what-if' scenarios without losing the original conversation."),
    
    # Branch B: Snapshots
    create_event(e8, e2, 8, "user_message",
        "[FORK B] Tell me about the snapshot optimization system"),
    
    create_event(e9, e8, 9, "assistant_message",
        "Chronos uses snapshots to avoid replaying 1000s of events. Every 50 events, it creates a checkpoint with the full conversation state. When you time-travel, it loads the nearest snapshot and replays only the delta. This keeps retrieval under 200ms even for long conversations."),
]

# Send to backend
try:
    response = requests.post(
        f"{API_BASE}/trace",
        json=events,
        headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
        timeout=10
    )
    
    if response.status_code == 201:
        print(f"✅ Demo trace created successfully!")
        print(f"📊 {response.json()}")
        print(f"\n🔗 View in UI: https://chronos-chi-eight.vercel.app")
        print(f"🔗 Conversation ID: {conv_id}")
    else:
        print(f"❌ Failed: {response.status_code}")
        print(response.text)
except Exception as e:
    print(f"❌ Error: {e}")
