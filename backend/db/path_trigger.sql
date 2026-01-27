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

DROP TRIGGER IF EXISTS set_path_before_insert ON events;

CREATE TRIGGER set_path_before_insert
    BEFORE INSERT ON events
    FOR EACH ROW
    EXECUTE FUNCTION calculate_path();