-- Fix: Replace GIN with BTREE for exact text matching
-- These indexes support queries like:
-- WHERE payload ->> 'gen_ai.operation.name' = 'chat'

-- Drop failed indexes if they partially exist
DROP INDEX IF EXISTS idx_events_payload_operation;
DROP INDEX IF EXISTS idx_events_payload_tool_name;

-- Create BTREE indexes for exact match queries
CREATE INDEX idx_events_payload_operation 
ON events ((payload ->> 'gen_ai.operation.name'));

CREATE INDEX idx_events_payload_tool_name 
ON events ((payload ->> 'gen_ai.tool.name'));

-- Verify indexes created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'events' 
ORDER BY indexname;
