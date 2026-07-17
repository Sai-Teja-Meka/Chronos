<p align="center">
  <img src="docs/img/Chronos-demo.gif" alt="Chronos Demo" width="33%" />
  <br><br>
</p>

<p align="center">
  <strong>Chronos</strong> is an event-sourced time-travel debugger for LLM conversations. It captures every message, tool call, and error as immutable events, enabling you to rewind conversations, fork "what-if" branches, and compare timelines side-by-side.
</p>

<p align="center">
  <a href="https://github.com/Sai-Teja-Meka/Chronos/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Sai-Teja-Meka/Chronos.svg" alt="License"></a>
  <a href="https://github.com/Sai-Teja-Meka/Chronos/releases/latest"><img src="https://img.shields.io/github/v/release/Sai-Teja-Meka/Chronos?sort=semver" alt="Latest release"></a>
  <a href="https://github.com/Sai-Teja-Meka/Chronos/issues"><img src="https://img.shields.io/github/issues/Sai-Teja-Meka/Chronos.svg" alt="Issues"></a>
  <a href="https://github.com/Sai-Teja-Meka/Chronos/network/members"><img src="https://img.shields.io/github/forks/Sai-Teja-Meka/Chronos.svg" alt="Forks"></a>
</p>

---

## 🎯 Use Cases

Below are some of the powerful debugging and development workflows enabled by Chronos:

| Time-Travel Debugging | Branch Comparison | What-If Testing |
|:---------------------:|:-----------------:|:---------------:|
| Rewind to any point in your LLM conversation history and inspect exact state | Compare multiple conversation branches side-by-side with metrics | Fork timelines to test alternate prompts, system messages, or tool outputs |

| Arena View | Live Updates | Tool Result Simulation |
|:----------:|:------------:|:----------------------:|
| Evaluate competing branches on cost, latency, and quality metrics | Real-time SSE updates as events are ingested | Inject simulated tool results to test edge cases |

---

## Why Chronos?

- **Event-Sourced Architecture** – Every interaction captured as immutable events in PostgreSQL
- **Time-Travel Replay** – Reconstruct conversation state at any point with snapshot optimization
- **Advanced Branching** – Fork conversations with user/system/assistant/tool mutations
- **Interactive Visualization** – ReactFlow-based graph UI with timeline playback and diff tools
- **Multi-Provider Branching** – Multi-provider branching (OpenAI + Anthropic); SDK capture currently supports OpenAI
- **Production-Ready Security** – API key auth, rate limiting, input validation, audit logging
- **Python SDK** – Context-aware interceptor with thread-safe design

---

## Architecture Overview
```
┌─────────────────────────────────────────────────────────────────┐
│                      Your LLM Application                       │
│                  (OpenAI Client + Chronos SDK)                  │
└────────────────────────┬────────────────────────────────────────┘
                         │ Events (messages, tool calls, errors)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Chronos Backend (FastAPI)                    │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Ingestion │  │ ReplayEngine │  │  BranchingService      │  │
│  │  Endpoint  │  │  (Snapshots) │  │  (Fork & Compare)      │  │
│  └────────────┘  └──────────────┘  └────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │ PostgreSQL + Redis
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Chronos Frontend (React)                    │
│  • ReactFlow Graph Visualization  • Timeline Playback           │
│  • Branch Comparison & Diff       • Arena Metrics View          │
│  • Live SSE Updates               • Fork Modal                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### 🚀 Quick Start (Docker)

The fastest way to get Chronos running locally:

1. **Clone the repository**
```bash
   git clone https://github.com/Sai-Teja-Meka/Chronos.git
   cd Chronos
```

2. **Configure environment variables**
```bash
   cp .env.example .env
   # Edit .env with your API keys and settings
```

3. **Start the stack**
```bash
   docker-compose up -d
```

   This launches:
   - PostgreSQL 15 (with schema initialization)
   - Redis 7 (for rate limiting)
   - Chronos Backend (FastAPI on port 8000)

4. **Start the frontend**
```bash
   cd frontend
   npm install
   npm run dev
```

   Frontend runs on [http://localhost:5173](http://localhost:5173)

5. **Generate demo trace**
```bash
   python generate_demo_trace.py
```

   This creates a sample conversation with branches. Copy the printed conversation ID and set `DEMO_CONVERSATION_ID` in `frontend/src/App.tsx` to view it (there is currently no in-UI input for the ID).

---

## 🐍 Python SDK

Install the Chronos SDK to capture events from your LLM application:
```bash
pip install ./chronos_sdk
```

### Basic Usage
```python
from openai import OpenAI
from chronos.interceptor import ChronosInterceptor
import requests

client = OpenAI(api_key="sk-...")

# Initialize interceptor with custom writer
def post_to_chronos(events):
    requests.post(
        "http://localhost:8000/trace",
        json=events,
        headers={"X-API-Key": "your-api-key"}
    )

interceptor = ChronosInterceptor(db_writer_callback=post_to_chronos)
client = interceptor.instrument_openai(client)

# Start tracing
with interceptor.trace_context(conversation_id="user-123"):
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is event sourcing?"}
        ]
    )
    print(response.choices[0].message.content)
```

The interceptor automatically captures:
- System prompts
- User messages
- Assistant responses (streaming & non-streaming)
- Tool calls and results
- Errors

---

## 🔧 Configuration

### Backend Environment Variables
```bash
# Database
DATABASE_URL=postgresql://chronos_user:chronos_password@localhost:5432/chronos

# Redis (for rate limiting)
REDIS_URL=redis://localhost:6379

# LLM Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Security
CHRONOS_API_KEYS=<comma-separated SHA-256 hashes>
CHRONOS_ADMIN_PASSWORD=<admin password>
CHRONOS_CORS_ORIGINS=http://localhost:5173

# Optional
PUBLIC_DEMO_MODE=false
```

### Frontend Environment Variables
```bash
VITE_API_URL=http://localhost:8000
VITE_CHRONOS_API_KEY=<your-api-key>
```

---

## 📊 Core Features

### 1. Event Ingestion

Send events to Chronos via the `/trace` endpoint:
```python
import requests
import uuid
from datetime import datetime

events = [{
    "event_id": str(uuid.uuid4()),
    "conversation_id": "conv-123",
    "parent_event_id": None,  # Root event
    "sequence_number": 1,
    "event_type": "user_message",
    "payload": {
        "gen_ai.input.messages": [{
            "role": "user",
            "parts": [{"type": "text", "text": "Hello!"}]
        }]
    },
    "metadata": {"source": "my-app"},
    "created_at": datetime.utcnow().isoformat() + "Z"
}]

requests.post(
    "http://localhost:8000/trace",
    json=events,
    headers={"X-API-Key": "your-key"}
)
```

### 2. Time-Travel Replay

The **ReplayEngine** reconstructs conversation state at any event:
```python
from app.services.replay import ReplayEngine

engine = ReplayEngine(db_connection_string, snapshot_interval=50)

# Get OpenAI-style messages for a specific event
messages = engine.fold_state(target_event_id="event-uuid")

# Returns: [
#   {"role": "system", "content": "..."},
#   {"role": "user", "content": "..."},
#   {"role": "assistant", "content": "..."},
#   ...
# ]
```

**Snapshot Optimization:**
- Snapshots created every N events (default: 50)
- O(1) lookup via materialized path arrays
- Sub-200ms replay even for 1000+ event conversations (measured on a
  1,050-event conversation: 29ms median via snapshots, 34ms median full
  traversal; 5 runs each, Docker Desktop on an i7-1250U / 16 GB RAM)

### 3. Advanced Branching

Fork conversations with mutations via `/branch/fork`:
```python
requests.post(
    "http://localhost:8000/branch/fork",
    json={
        "parent_event_id": "event-uuid",
        "mutation_type": "user_message",  # or system_message, tool_result
        "content": "What if I asked differently?",
        "model": "gpt-4"
    },
    headers={"X-API-Key": "your-key"}
)
```

**Supported Mutation Types:**
- `user_message` – Add new user input
- `system_message` – Change system prompt
- `assistant_message` – Force specific response (no LLM call)
- `tool_result` – Simulate tool execution outcome

### 4. Branch Comparison

Compare two timeline branches:
```python
response = requests.get(
    "http://localhost:8000/branch/compare",
    params={"branch_a": "event-a-uuid", "branch_b": "event-b-uuid"},
    headers={"X-API-Key": "your-key"}
)

# Returns:
# {
#   "branch_a": {"tokens": 1200, "latency": 3400, "steps": 8},
#   "branch_b": {"tokens": 950, "latency": 2800, "steps": 7},
#   "diff": {"token_delta": -250, "latency_delta_ms": -600}
# }
```

### 5. Live Updates (SSE)

Frontend subscribes to real-time graph updates:
```javascript
const eventSource = new EventSource(
  `http://localhost:8000/stream/graph/${conversationId}`
);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'ingest' || data.type === 'fork') {
    // Refresh graph
  }
};
```

---

## 🖼️ Frontend Features

### Graph Visualization
- **ReactFlow** with elkjs hierarchical layout
- Active path highlighting (cyan, animated edges)
- Mini-map with color-coded event types
- Performance mode for large graphs (>200 nodes)

### Timeline Mode
- Play/pause/step through conversation history
- Adjustable playback speed (0.5x - 3x)
- Progressive node/edge reveal with smooth transitions

### Branch Comparison
- Select two nodes to find divergence point
- Visual diff panel showing structural differences
- Automatic viewport centering on compared branches

### Arena View
- Side-by-side metrics for all branches
- Token count, latency, step count comparison
- Click to focus on specific branch

### Fork Modal
- Choose mutation type (user/system/assistant/tool)
- Enter content and tool details
- Select LLM model (GPT-4, Claude Opus/Sonnet/Haiku)

---

## 📦 API Reference

### Core Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/trace` | Ingest events | ✅ |
| `GET` | `/trace/{conversation_id}` | Get graph | Conditional |
| `POST` | `/branch/fork` | Fork conversation | ✅ |
| `GET` | `/branch/compare` | Compare branches | ✅ |
| `GET` | `/stream/graph/{conversation_id}` | SSE updates | ❌ |
| `POST` | `/snapshots/create/{event_id}` | Create snapshot | ✅ |
| `POST` | `/snapshots/ensure/{conversation_id}` | Ensure snapshots | ✅ |
| `GET` | `/health` | Health check | ❌ |

### Event Schema
```typescript
{
  event_id: string;           // UUID
  conversation_id: string;    // UUID
  parent_event_id: string | null;
  sequence_number: number;
  event_type: "user_message" | "assistant_message" | "tool_call" | 
              "tool_result" | "system_message" | "error";
  payload: object;            // OTel-style structured data
  metadata: object;           // Tokens, latency, flags
  created_at: string;         // ISO 8601
}
```

---

## 🔒 Security

### API Key Management

1. **Generate a new key:**
```bash
   curl -X POST http://localhost:8000/admin/generate-key \
     -H "Content-Type: application/json" \
     -d '{"admin_password": "your-admin-password"}'
```

2. **Hash the key (SHA-256):**
```bash
   echo -n "chronos_abc123..." | sha256sum
```

3. **Add to environment:**
```bash
   CHRONOS_API_KEYS=<hash1>,<hash2>,...
```

### Rate Limiting

- Default: **100 requests/minute** per API key
- Redis-backed with moving window strategy
- Returns `429 Too Many Requests` when exceeded
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Input Validation

- UUID format validation for IDs
- Event type whitelist enforcement
- JSON payload size limit (1 MB)
- String length sanitization (10,000 chars)
- SQL injection prevention via parameterized queries

---

## 🏗️ Database Schema

### Events Table
```sql
CREATE TABLE events (
    event_id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL,
    parent_event_id UUID,
    sequence_number INTEGER NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL,
    path UUID[] -- Materialized ancestry for fast queries
);

CREATE INDEX idx_conversation ON events(conversation_id);
CREATE INDEX idx_parent ON events(parent_event_id);
CREATE INDEX idx_path ON events USING GIN(path);
```

### Snapshots Table
```sql
CREATE TABLE snapshots (
    snapshot_id UUID PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    state_datum JSONB NOT NULL, -- Serialized messages array
    event_count INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL
);
```

---

## 🛠️ Development

### Build from Source
```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev

# SDK
cd chronos_sdk
pip install -e .
```

### Run Tests
```bash
# Backend
pytest backend/tests/

# Frontend
cd frontend
npm test
```

### Database Migrations

SQL migration scripts in `backend/db/`:
- `schema.sql` – Initial tables and indices
- `path_trigger.sql` – Materialized path maintenance
- `add_snapshot_optimization.sql` – Snapshot system
- `fix_indexes.sql` – Performance indices

Apply manually or via Docker entrypoint on first run.

---

## 🌐 Supported Platforms

### Operating Systems

| Ubuntu | macOS | Windows | Docker |
|:------:|:-----:|:-------:|:------:|
| ✅ | ✅ | ✅ | ✅ |

### Python Versions

| 3.8 | 3.9 | 3.10 | 3.11 | 3.12 |
|:---:|:---:|:----:|:----:|:----:|
| ✅ | ✅ | ✅ | ✅ | ✅ |

### LLM Providers

| OpenAI | Anthropic (Claude) |
|:------:|:------------------:|
| ✅ GPT-3.5, GPT-4, GPT-4o | ✅ Haiku, Sonnet, Opus |

---

## ⚠️ Known Limitations

- Snapshot interval placement is branch-naive on heavily-forked conversations — snapshots remain correct, but their placement is suboptimal.
- The auto-snapshot trigger over-creates placeholder rows on batch inserts (one per row whenever a batch lands on a multiple of 50). Placeholders are never used as a replay base, so this is harmless, but the snapshots table can grow larger than expected.
- The `/trace` response counts (`inserted`/`duplicates`) are inaccurate for batches larger than 100 events due to psycopg2 `execute_values` paging; all events are still inserted correctly.

---

## 🤝 Community & Support

- [🐛 Report Issues](https://github.com/Sai-Teja-Meka/Chronos/issues)
- [💬 Discussions](https://github.com/Sai-Teja-Meka/Chronos/discussions)

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

---

## 🙏 Acknowledgments

Built with:
- [FastAPI](https://fastapi.tiangolo.com/) – Modern Python web framework
- [ReactFlow](https://reactflow.dev/) – Interactive graph visualization
- [PostgreSQL](https://www.postgresql.org/) – Robust event storage
- [Redis](https://redis.io/) – High-performance rate limiting
- [OpenAI](https://openai.com/) & [Anthropic](https://www.anthropic.com/) – LLM providers

---

<p align="center">
  <strong>⏱️ Time-travel your LLM conversations with Chronos</strong>
</p>

<p align="center">
  <a href="https://github.com/Sai-Teja-Meka/Chronos" target="_blank">⭐ Star us on GitHub</a>
</p>




