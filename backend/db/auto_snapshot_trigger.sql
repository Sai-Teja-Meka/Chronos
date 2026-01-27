-- Automatic Snapshot Creation System
-- Creates snapshots every 50 events automatically

-- Function to check and create snapshot
CREATE OR REPLACE FUNCTION auto_create_snapshot() RETURNS TRIGGER AS $$
DECLARE
    event_count INTEGER;
    snapshot_interval INTEGER := 50;  -- Create snapshot every 50 events
    last_snapshot_count INTEGER;
BEGIN
    -- Count events in this conversation's current branch
    SELECT COUNT(*) INTO event_count
    FROM events
    WHERE conversation_id = NEW.conversation_id
    AND NEW.event_id = ANY(
        SELECT unnest(path) FROM events WHERE event_id = NEW.event_id
    );
    
    -- Check if we should create a snapshot (every 50 events)
    IF event_count % snapshot_interval = 0 THEN
        -- Check if snapshot already exists for this event
        IF NOT EXISTS (SELECT 1 FROM snapshots WHERE event_id = NEW.event_id) THEN
            -- Log that snapshot should be created
            -- Note: Actual snapshot creation is deferred to Python for state reconstruction
            RAISE NOTICE 'Snapshot needed for event % at count %', NEW.event_id, event_count;
            
            -- Insert a placeholder snapshot record that will be populated by Python
            INSERT INTO snapshots (snapshot_id, event_id, state_datum, event_count)
            VALUES (gen_random_uuid(), NEW.event_id, '[]'::jsonb, event_count)
            ON CONFLICT (event_id) DO NOTHING;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically create snapshots
DROP TRIGGER IF EXISTS trigger_auto_snapshot ON events;

CREATE TRIGGER trigger_auto_snapshot
    AFTER INSERT ON events
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_snapshot();

-- Function to manually ensure snapshots for a conversation
CREATE OR REPLACE FUNCTION ensure_snapshots(p_conversation_id UUID, p_interval INTEGER DEFAULT 50) 
RETURNS TABLE(event_id UUID, event_count INTEGER, snapshot_created BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    WITH conversation_events AS (
        SELECT 
            e.event_id,
            e.sequence_number,
            ROW_NUMBER() OVER (ORDER BY e.sequence_number) as rn
        FROM events e
        WHERE e.conversation_id = p_conversation_id
        ORDER BY e.sequence_number
    ),
    snapshot_points AS (
        SELECT 
            ce.event_id,
            ce.rn as event_count
        FROM conversation_events ce
        WHERE ce.rn % p_interval = 0
    )
    SELECT 
        sp.event_id,
        sp.event_count::INTEGER,
        NOT EXISTS(SELECT 1 FROM snapshots s WHERE s.event_id = sp.event_id) as snapshot_created
    FROM snapshot_points sp;
END;
$$ LANGUAGE plpgsql;

-- Usage examples:
-- 1. Check what snapshots should exist:
--    SELECT * FROM ensure_snapshots('550e8400-e29b-41d4-a716-446655440099');
--
-- 2. The trigger automatically creates snapshot placeholders on INSERT
--    Python backend will populate the state_datum field

COMMENT ON FUNCTION auto_create_snapshot() IS 'Automatically creates snapshot placeholders every 50 events';
COMMENT ON FUNCTION ensure_snapshots(UUID, INTEGER) IS 'Returns snapshot points that should exist for a conversation';