WITH RECURSIVE actual_path AS (
    SELECT event_id, ARRAY[event_id] AS calculated_path
    FROM events
    WHERE parent_event_id IS NULL

    UNION ALL

    SELECT e.event_id, ap.calculated_path || e.event_id
    FROM events e
    INNER JOIN actual_path ap
        ON e.parent_event_id = ap.event_id
)
SELECT
    e.event_id,
    e.path AS stored_path,
    ap.calculated_path,
    e.path = ap.calculated_path AS is_valid
FROM events e
JOIN actual_path ap
    ON e.event_id = ap.event_id
WHERE e.path != ap.calculated_path;
