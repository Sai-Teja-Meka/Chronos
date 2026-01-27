-- Migration: Add snapshot optimization support
-- This adds the event_count column and ensures snapshots table is properly configured

-- Add event_count column if it doesn't exist
ALTER TABLE snapshots 
ADD COLUMN IF NOT EXISTS event_count INTEGER DEFAULT 0;

-- Add unique constraint on event_id if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'snapshots_event_id_key'
    ) THEN
        ALTER TABLE snapshots 
        ADD CONSTRAINT snapshots_event_id_key UNIQUE (event_id);
    END IF;
END $$;

-- Add index on event_count for efficient snapshot selection
CREATE INDEX IF NOT EXISTS idx_snapshots_event_count 
ON snapshots(event_count DESC);

-- Add index on created_at for cleanup operations
CREATE INDEX IF NOT EXISTS idx_snapshots_created_at 
ON snapshots(created_at DESC);

-- Verify schema
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'snapshots'
ORDER BY ordinal_position;