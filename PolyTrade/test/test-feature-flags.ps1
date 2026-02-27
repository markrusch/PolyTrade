# Test Feature Flags - Orderbook-Only Mode
# Run the backend with Binance and Deribit disabled

Write-Host "`n=== Testing Feature Flags: Orderbook-Only Mode ===" -ForegroundColor Cyan
Write-Host "Disabling Binance and Deribit services...`n" -ForegroundColor Yellow

# Stop any running servers
Write-Host "Stopping existing Node processes..." -ForegroundColor Gray
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Start-Sleep 2

# Set environment variables
$env:ENABLE_BINANCE='false'
$env:ENABLE_DERIBIT='false'
$env:ENABLE_POLYMARKET_TRADING='true'
$env:POLYMARKET_FUNDER_ADDRESS='0x5A026A851AEF0d7835210587E3bEeD46F8C7cC97'
$env:POLYMARKET_USER_ADDRESS='0x5A026A851AEF0d7835210587E3bEeD46F8C7cC97'

Write-Host "Feature Flags:" -ForegroundColor Green
Write-Host "  ENABLE_BINANCE: $env:ENABLE_BINANCE" -ForegroundColor White
Write-Host "  ENABLE_DERIBIT: $env:ENABLE_DERIBIT" -ForegroundColor White
Write-Host "  ENABLE_POLYMARKET_TRADING: $env:ENABLE_POLYMARKET_TRADING" -ForegroundColor White
Write-Host ""

# Change to project directory
$projectDir = "c:\Users\markr\OneDrive\Documents\Mark Rusch\sandbox\PolyTrade"
Set-Location $projectDir

Write-Host "Building project..." -ForegroundColor Gray
npm run build 2>&1 | Select-String "error|tsc" | ForEach-Object { Write-Host $_ }

Write-Host "`nStarting backend server (orderbook-only mode)..." -ForegroundColor Cyan
Write-Host "Expected output:" -ForegroundColor Gray
Write-Host "  ✅ CLOB client initialized" -ForegroundColor Gray
Write-Host "  ⏭️  Binance disabled (ENABLE_BINANCE=false)" -ForegroundColor Gray
Write-Host "  ⏭️  Deribit disabled (ENABLE_DERIBIT=false)" -ForegroundColor Gray
Write-Host "  ✅ All services ready`n" -ForegroundColor Gray

Write-Host "Press Ctrl+C to stop the server and run tests`n" -ForegroundColor Yellow

# Start server and show relevant output
npm run server 2>&1 | Select-String "CLOB|Binance|Deribit|HTTP Server|WebSocket|All services"
