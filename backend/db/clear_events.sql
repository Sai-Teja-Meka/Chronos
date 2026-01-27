-- Delete all events (CASCADE removes related data too)
TRUNCATE TABLE events RESTART IDENTITY CASCADE;
TRUNCATE TABLE snapshots RESTART IDENTITY CASCADE;

-- Verify deletion
SELECT COUNT(*) as remaining_events FROM events;
SELECT COUNT(*) as remaining_snapshots FROM snapshots;