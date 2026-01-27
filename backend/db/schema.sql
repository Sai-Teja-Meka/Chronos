/*
 * Project Chronos - Database Schema
 * Version: 1.0.0
 * * Architecture: Hybrid Relational-Document Model
 * Core Features:
 * - Immutable Event Sourcing
 * - Directed Acyclic Graph (DAG) via self-referencing parent_id
 * - Materialized Path for O(1) ancestry lookups
 * - JSONB Payloads for OTel v1.37+ compliance
 */

-- 1. EXTENSIONS
-- Required for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABLES

-- Table: events
-- The append-only log of all conversation states.
CREATE TABLE IF NOT EXISTS events (
    -- Primary Identity
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Timeline Grouping
    -- Groups all branches of a single "session" together.
    conversation_id UUID NOT NULL,

    -- DAG Topology
    -- Points to the immediate predecessor. NULL indicates the Root.
    parent_event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,

    -- Logical Ordering
    -- Step number within a specific branch. Not unique per conversation (parallel branches).
    sequence_number BIGINT NOT NULL CHECK (sequence_number >= 0),

    -- Event Taxonomy
    -- Enum-like values: 'user_message', 'assistant_message', 'tool_call', 'tool_result', 'error', 'branch_create'
    event_type VARCHAR(50) NOT NULL,

    -- Data Payload (OTel v1.37+)
    -- Stores 'gen_ai.input.messages' or 'gen_ai.output.messages' with 'parts' arrays.
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Telemetry Metadata
    -- Latency, token counts, model identifiers, cost.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Materialized Path (Optimization)
    -- Stores the full lineage [root_id, ..., parent_id, current_id].
    -- Auto-populated via Trigger (see below).
    path UUID[] DEFAULT ARRAY[]::UUID[],

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table: snapshots (Phase 2 & 7 Optimization)
-- Stores full state reconstruction at specific intervals (e.g., every 50 turns).
CREATE TABLE IF NOT EXISTS snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    
    -- The fully folded state (List[Message]) at this point in time
    state_datum JSONB NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. INDEXES

-- A. Relational Topology
-- Accelerates "Show me history for conversation X"
CREATE INDEX idx_events_conversation_id ON events(conversation_id);
-- Accelerates "Find children of this node" (Branching)
CREATE INDEX idx_events_parent_event_id ON events(parent_event_id);
-- Accelerates "Traverse specific branch ordered by time"
CREATE INDEX idx_events_parent_sequence ON events(parent_event_id, sequence_number);

-- B. JSONB Content (OTel Specifics)
-- Accelerates "Find all tool executions" or "Find all errors"
CREATE INDEX idx_events_payload_operation ON events USING GIN ((payload ->> 'gen_ai.operation.name'));
-- Accelerates "Find usage patterns of specific tools" (Phase 6 Pattern Detection)
CREATE INDEX idx_events_payload_tool_name ON events USING GIN ((payload ->> 'gen_ai.tool.name'));

-- C. Optimization
-- Accelerates "Fetch full lineage" using the Materialized Path (Phase 7)
CREATE INDEX idx_events_path ON events USING GIN (path);

-- 4. TRIGGERS

-- Function: calculate_path()
-- Automatically computes the lineage array on INSERT.
-- If Root: path = [new_id]
-- If Child: path = parent.path + [new_id]
CREATE OR REPLACE FUNCTION calculate_path() RETURNS TRIGGER AS $$
DECLARE
    parent_path UUID[];
BEGIN
    IF NEW.parent_event_id IS NULL THEN
        NEW.path := ARRAY[NEW.event_id];
    ELSE
        SELECT path INTO parent_path FROM events WHERE event_id = NEW.parent_event_id;
        NEW.path := parent_path || NEW.event_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: set_path_before_insert
CREATE TRIGGER set_path_before_insert
    BEFORE INSERT ON events
    FOR EACH ROW
    EXECUTE FUNCTION calculate_path();

-- 5. DOCUMENTATION
COMMENT ON TABLE events IS 'Immutable event log for Project Chronos Time-Traveling Debugger.';
COMMENT ON COLUMN events.path IS 'Materialized path of ancestor UUIDs for O(1) history retrieval.';