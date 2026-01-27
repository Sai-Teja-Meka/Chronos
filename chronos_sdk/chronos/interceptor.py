import time
import uuid
import json
import threading
import queue
import functools
import contextvars
from typing import List, Dict, Any, Generator, Union, Optional
from datetime import datetime
from contextlib import contextmanager

# ==========================================
# 🧠 CONTEXT VARIABLE ECOSYSTEM
# ==========================================
# These replace the dangerous "self.conversation_id" instance attributes.
# They live in thread-local storage (TLS) or async task contexts.

_cv_conversation_id = contextvars.ContextVar("chronos_conversation_id", default=None)
_cv_parent_event_id = contextvars.ContextVar("chronos_parent_event_id", default=None)
_cv_sequence_counter = contextvars.ContextVar("chronos_sequence_counter", default=0)


# Placeholder for DB writer
def write_batch_to_postgres(events: List[Dict]):
    """Simulates flushing the buffer to the 'events' table."""
    print(f"--> [DB WRITE] Flushed {len(events)} events to Postgres.")


class ChronosInterceptor:
    """
    Thread-safe, Request-Isolated Interceptor for OpenAI.
    """
    def __init__(self, db_writer_callback=write_batch_to_postgres, buffer_size=10, flush_interval=0.5):
        # ⚠️ CRITICAL CHANGE: No instance state for ID/Sequence!
        
        # Buffering Strategy
        self._buffer: queue.Queue = queue.Queue()
        self._buffer_size = buffer_size
        self._flush_interval = flush_interval
        self._writer_callback = db_writer_callback
        
        # Background Flusher
        self._stop_event = threading.Event()
        self._flusher_thread = threading.Thread(target=self._background_flush, daemon=True)
        self._flusher_thread.start()

    # ==========================================
    # 🛡️ CONTEXT MANAGEMENT (THE FIX)
    # ==========================================

    @contextmanager
    def trace_context(self, conversation_id: Optional[str] = None, parent_id: Optional[str] = None):
        """
        Starts a new tracing scope. 
        Usage:
            with interceptor.trace_context(conversation_id="user-123"):
                response = client.chat.completions.create(...)
        """
        # 1. Set new context
        token_cid = _cv_conversation_id.set(conversation_id or str(uuid.uuid4()))
        token_pid = _cv_parent_event_id.set(parent_id)
        token_seq = _cv_sequence_counter.set(0)
        
        try:
            yield
        finally:
            # 2. Reset context (Clean up to prevent leaking into next request)
            _cv_conversation_id.reset(token_cid)
            _cv_parent_event_id.reset(token_pid)
            _cv_sequence_counter.reset(token_seq)

    def _get_or_init_context(self) -> str:
        """
        Fallback: If user forgot 'with trace_context()', verify we have an ID.
        If not, create one lazily for this thread/task.
        """
        cid = _cv_conversation_id.get()
        if not cid:
            # ⚠️ LAZY INIT: Auto-create context for this thread if missing
            new_cid = str(uuid.uuid4())
            _cv_conversation_id.set(new_cid)
            return new_cid
        return cid

    # ==========================================
    # 🎣 INSTRUMENTATION HOOKS
    # ==========================================

    def instrument_openai(self, client):
        """Wraps OpenAI client to capture both streaming and non-streaming calls."""
        original_create = client.chat.completions.create

        @functools.wraps(original_create)
        def wrapper(*args, **kwargs):
            # Ensure context exists
            self._get_or_init_context()

            # 1. CAPTURE CONTEXT
            input_messages = kwargs.get("messages", [])
            model = kwargs.get("model", "unknown")
            is_stream = kwargs.get("stream", False)
            
            # Generate Event UUIDs
            user_event_id = str(uuid.uuid4())
            assistant_event_id = str(uuid.uuid4())

            # --- BOOTSTRAP RULE ---
            current_seq = _cv_sequence_counter.get()
            if current_seq == 0:
                self._capture_system_prompt(input_messages, model)
            
            # A. Process Input
            self._process_input_messages(input_messages, user_event_id, model)

            start_time = time.time()
            
            # 2. EXECUTE
            try:
                response = original_create(*args, **kwargs)
                
                # B. Handle Streaming
                if is_stream:
                    return self._handle_streaming_response(response, assistant_event_id, model, start_time)
                
                # C. Handle Standard Response
                latency_ms = (time.time() - start_time) * 1000
                self._capture_assistant_event(response, assistant_event_id, latency_ms)
                return response
                
            except Exception as e:
                self._capture_error_event(e, input_messages)
                raise e

        client.chat.completions.create = wrapper
        return client

    # ==========================================
    # 📸 EVENT CAPTURE LOGIC
    # ==========================================

    def _capture_system_prompt(self, messages: List[Dict], model: str):
        for msg in messages:
            if msg.get('role') == 'system':
                event_id = str(uuid.uuid4())
                payload = {
                    "gen_ai.operation.name": "chat",
                    "gen_ai.provider.name": "openai",
                    "gen_ai.input.messages": [{
                        "role": "system",
                        "parts": [{"type": "text", "text": msg.get("content")}]
                    }]
                }
                # Root event has no parent
                self._enqueue_event(event_id, "system_message", payload, {}, is_root=True)
                break

    def _process_input_messages(self, messages: List[Dict], trigger_event_id: str, model: str):
        if not messages: return

        last_msg = messages[-1]
        
        if last_msg.get('role') == 'tool':
            payload = {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.call.id": last_msg.get('tool_call_id'),
                "gen_ai.input.messages": [{
                    "role": "tool",
                    "parts": [{
                        "type": "tool_result",
                        "id": last_msg.get('tool_call_id'),
                        "content": self._safe_json_load(last_msg.get('content'))
                    }]
                }]
            }
            self._enqueue_event(trigger_event_id, "tool_result", payload, {"status": "success"})

        else:
            otel_role = last_msg.get('role', 'user')
            payload = {
                "gen_ai.operation.name": "chat",
                "gen_ai.input.messages": [{
                    "role": otel_role,
                    "parts": [{"type": "text", "text": last_msg.get("content")}]
                }]
            }
            self._enqueue_event(trigger_event_id, "user_message", payload, {})

    def _handle_streaming_response(self, response_generator, event_id: str, model: str, start_time: float):
        full_content = []
        tool_calls_buffer = {} 
        finish_reason = None
        
        # Generator Wrapper
        for chunk in response_generator:
            delta = chunk.choices[0].delta
            
            if delta.content:
                full_content.append(delta.content)
            
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    if tc.id:
                        tool_calls_buffer[tc.index] = {"id": tc.id, "name": tc.function.name, "arguments": ""}
                    if tc.function.arguments:
                        tool_calls_buffer[tc.index]["arguments"] += tc.function.arguments

            if chunk.choices[0].finish_reason:
                finish_reason = chunk.choices[0].finish_reason

            yield chunk

        # Post-Stream Capture
        latency_ms = (time.time() - start_time) * 1000
        combined_text = "".join(full_content)
        
        if tool_calls_buffer:
            parts = []
            top_name = None
            for idx, tc_data in tool_calls_buffer.items():
                parts.append({
                    "type": "tool_use",
                    "id": tc_data["id"],
                    "name": tc_data["name"],
                    "arguments": self._safe_json_load(tc_data["arguments"])
                })
                if not top_name: top_name = tc_data["name"]
            
            payload = {
                "gen_ai.operation.name": "chat",
                "gen_ai.output.messages": [{"role": "assistant", "finish_reason": "tool_calls", "parts": parts}],
                "gen_ai.tool.name": top_name 
            }
            self._enqueue_event(event_id, "tool_call", payload, {"latency_ms": latency_ms, "streamed": True})

        elif combined_text:
            payload = {
                "gen_ai.operation.name": "chat",
                "gen_ai.output.messages": [{"role": "assistant", "finish_reason": finish_reason, "parts": [{"type": "text", "text": combined_text}]}]
            }
            self._enqueue_event(event_id, "assistant_message", payload, {"latency_ms": latency_ms, "streamed": True})

    def _capture_assistant_event(self, response, event_id: str, latency_ms: float):
        choice = response.choices[0]
        message = choice.message
        
        if message.tool_calls:
            parts = []
            top_name = None
            for tc in message.tool_calls:
                parts.append({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": self._safe_json_load(tc.function.arguments)
                })
                if not top_name: top_name = tc.function.name

            payload = {
                "gen_ai.operation.name": "chat",
                "gen_ai.output.messages": [{"role": "assistant", "finish_reason": "tool_calls", "parts": parts}],
                "gen_ai.tool.name": top_name
            }
            self._enqueue_event(event_id, "tool_call", payload, {"latency_ms": latency_ms})

        else:
            payload = {
                "gen_ai.operation.name": "chat",
                "gen_ai.output.messages": [{"role": "assistant", "finish_reason": choice.finish_reason, "parts": [{"type": "text", "text": message.content}]}]
            }
            self._enqueue_event(event_id, "assistant_message", payload, {"latency_ms": latency_ms})

    def _capture_error_event(self, error: Exception, input_messages: List[Dict]):
        event_id = str(uuid.uuid4())
        otel_inputs = [{"role": m.get("role", "unknown"), "parts": [{"type": "text", "text": str(m.get("content", ""))}]} for m in input_messages]

        payload = {
            "gen_ai.operation.name": "chat",
            "error.type": type(error).__name__,
            "error.message": str(error),
            "gen_ai.input.messages": otel_inputs
        }
        self._enqueue_event(event_id, "error", payload, {})

    # ==========================================
    # ⚙️ INTERNAL UTILS
    # ==========================================

    def _enqueue_event(self, event_id: str, event_type: str, payload: Dict, metadata: Dict, is_root: bool = False):
        """Thread-safe, Context-Aware Enqueue"""
        
        # 1. READ CONTEXT
        cid = _cv_conversation_id.get()
        pid = _cv_parent_event_id.get()
        seq = _cv_sequence_counter.get()

        if is_root:
            pid = None # Root overrides parent

        # Check for self-loop (Safety)
        if pid == event_id:
             # This can happen if we process input and output in same ID (unlikely with new UUIDs)
             pid = None 
    
        event_row = {
            "event_id": event_id,
            "conversation_id": str(cid),
            "parent_event_id": pid,
            "sequence_number": seq,
            "event_type": event_type,
            "payload": payload,
            "metadata": metadata,
            "created_at": datetime.utcnow().isoformat()
        }
        
        # 2. UPDATE CONTEXT (Next event will be child of this one)
        _cv_parent_event_id.set(event_id)
        _cv_sequence_counter.set(seq + 1)
        
        self._buffer.put(event_row)

    def _safe_json_load(self, json_str: Union[str, dict, None]) -> Union[Dict, str]:
        if json_str is None: return ""
        if isinstance(json_str, dict): return json_str
        try:
            return json.loads(json_str)
        except (json.JSONDecodeError, TypeError):
            return str(json_str)

    def _background_flush(self):
        batch = []
        while not self._stop_event.is_set():
            try:
                event = self._buffer.get(timeout=self._flush_interval)
                batch.append(event)
                if len(batch) >= self._buffer_size:
                    self._writer_callback(batch)
                    batch = []
            except queue.Empty:
                if batch:
                    self._writer_callback(batch)
                    batch = []