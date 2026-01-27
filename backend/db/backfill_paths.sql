-- Backfill paths for all existing events
WITH RECURSIVE path_calc AS (
    -- Base case: root nodes (no parent)
    SELECT 
        event_id,
        parent_event_id,
        ARRAY[event_id] as path
    FROM events
    WHERE parent_event_id IS NULL
    
    UNION ALL
    
    -- Recursive case: child nodes
    SELECT 
        e.event_id,
        e.parent_event_id,
        pc.path || e.event_id
    FROM events e
    INNER JOIN path_calc pc ON e.parent_event_id = pc.event_id
)
UPDATE events e
SET path = pc.path
FROM path_calc pc
WHERE e.event_id = pc.event_id;

-- Show results
SELECT event_id, sequence_number, array_length(path, 1) as depth, path 
FROM events 
ORDER BY sequence_number, created_at;