@echo off
echo === CHRONOS DEBUG SCRIPT ===
echo.

echo [1/5] Testing Database Connection...
docker exec -it chronos_db psql -U chronos_user -d chronos -c "SELECT 1;" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ Database Connected
) else (
    echo ✗ Database Connection Failed
    exit /b 1
)

echo [2/5] Checking Schema...
docker exec -it chronos_db psql -U chronos_user -d chronos -c "\dt" | find "events" >nul
if %errorlevel% equ 0 (
    echo ✓ Schema Loaded
) else (
    echo ✗ Schema Missing
)

echo [3/5] Counting Events...
docker exec -it chronos_db psql -U chronos_user -d chronos -t -c "SELECT COUNT(*) FROM events;"

echo [4/5] Testing Backend API...
curl -s http://localhost:8000/ >nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ Backend Responding
) else (
    echo ✗ Backend Down
)

echo [5/5] Testing Graph Endpoint...
curl -s http://localhost:8000/trace/550e8400-e29b-41d4-a716-446655440099 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ Graph Endpoint Working
) else (
    echo ✗ Graph Endpoint Failed
)

echo.
echo === TEST COMPLETE ===