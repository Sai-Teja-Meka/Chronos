@echo off
echo ========================================
echo   SNAPSHOT MIGRATION - DIRECT APPROACH
echo ========================================
echo.

echo Step 1: Adding event_count column...
docker exec -i chronos_db psql -U chronos_user -d chronos -c "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS event_count INTEGER DEFAULT 0;"

echo.
echo Step 2: Adding unique constraint...
docker exec -i chronos_db psql -U chronos_user -d chronos -c "ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_event_id_key; ALTER TABLE snapshots ADD CONSTRAINT snapshots_event_id_key UNIQUE (event_id);"

echo.
echo Step 3: Creating indexes...
docker exec -i chronos_db psql -U chronos_user -d chronos -c "CREATE INDEX IF NOT EXISTS idx_snapshots_event_count ON snapshots(event_count DESC);"
docker exec -i chronos_db psql -U chronos_user -d chronos -c "CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at DESC);"

echo.
echo Step 4: Verifying schema...
docker exec -i chronos_db psql -U chronos_user -d chronos -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'snapshots' ORDER BY ordinal_position;"

echo.
echo ========================================
echo   MIGRATION COMPLETE!
echo ========================================
echo.
echo Next step: Install auto-snapshot trigger
echo Run: install_snapshot_trigger.bat
echo.
pause