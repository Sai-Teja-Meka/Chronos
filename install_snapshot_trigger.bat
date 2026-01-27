@echo off
echo ========================================
echo   INSTALLING AUTO-SNAPSHOT TRIGGER
echo ========================================
echo.

echo Step 1: Dropping old trigger/function...
docker exec -i chronos_db psql -U chronos_user -d chronos -c "DROP TRIGGER IF EXISTS trigger_auto_snapshot ON events;"
docker exec -i chronos_db psql -U chronos_user -d chronos -c "DROP FUNCTION IF EXISTS auto_create_snapshot();"

echo.
echo Step 2: Creating auto-snapshot function...
docker exec -i chronos_db psql -U chronos_user -d chronos -c "CREATE FUNCTION auto_create_snapshot() RETURNS TRIGGER AS $func$ DECLARE event_count INTEGER; snapshot_interval INTEGER := 50; BEGIN SELECT COUNT(*) INTO event_count FROM events WHERE conversation_id = NEW.conversation_id AND NEW.event_id = ANY(SELECT unnest(path) FROM events WHERE event_id = NEW.event_id); IF event_count %% snapshot_interval = 0 THEN IF NOT EXISTS (SELECT 1 FROM snapshots WHERE event_id = NEW.event_id) THEN INSERT INTO snapshots (snapshot_id, event_id, state_datum, event_count) VALUES (gen_random_uuid(), NEW.event_id, '[]'::jsonb, event_count) ON CONFLICT (event_id) DO NOTHING; END IF; END IF; RETURN NEW; END; $func$ LANGUAGE plpgsql;"

echo.
echo Step 3: Creating trigger...
docker exec -i chronos_db psql -U chronos_user -d chronos -c "CREATE TRIGGER trigger_auto_snapshot AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION auto_create_snapshot();"

echo.
echo Step 4: Verifying...
docker exec -i chronos_db psql -U chronos_user -d chronos -c "SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'events';"

echo.
echo ========================================
echo   TRIGGER INSTALLED!
echo ========================================
echo.
echo Snapshots will now be created automatically every 50 events.
echo.
pause