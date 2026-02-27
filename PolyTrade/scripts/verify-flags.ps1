# Verify Feature Flags - Check if backend is respecting feature flag settings
# Usage: .\verify-flags.ps1

Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        VERIFY FEATURE FLAGS IN RUNNING BACKEND              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Wait a moment to ensure backend is ready
Write-Host "Checking backend health endpoint..." -ForegroundColor Gray
Start-Sleep 2

try {
    $health = (Invoke-WebRequest -UseBasicParsing http://localhost:3003/api/health -TimeoutSec 5).Content | ConvertFrom-Json
    
    Write-Host "`n✅ Backend is running" -ForegroundColor Green
    Write-Host "`nFeature Flags Status:" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────────────────────" -ForegroundColor Gray
    
    # Check Binance
    $binanceStatus = if ($health.features.binance) { "🟢 ENABLED" } else { "🔴 DISABLED" }
    $binanceService = if ($health.services.binance) { "✅ Running" } else { "⏹️  Stopped" }
    Write-Host "BINANCE:       $binanceStatus  |  Service: $binanceService" -ForegroundColor $(if ($health.features.binance) { "Green" } else { "Gray" })
    
    # Check Deribit
    $deribitStatus = if ($health.features.deribit) { "🟢 ENABLED" } else { "🔴 DISABLED" }
    $deribitService = if ($health.services.deribit) { "✅ Running" } else { "⏹️  Stopped" }
    Write-Host "DERIBIT:       $deribitStatus  |  Service: $deribitService" -ForegroundColor $(if ($health.features.deribit) { "Green" } else { "Gray" })
    
    # Check Polymarket Trading
    $tradingStatus = if ($health.features.polymarketTrading) { "🟢 ENABLED" } else { "🔴 DISABLED" }
    Write-Host "TRADING:       $tradingStatus  |  (Read/Write)" -ForegroundColor $(if ($health.features.polymarketTrading) { "Green" } else { "Yellow" })
    
    Write-Host "─────────────────────────────────────────────────────────────`n" -ForegroundColor Gray
    
    # Verify flags match service status
    $flagsOk = $true
    
    if ($health.features.binance -and !$health.services.binance) {
        Write-Host "⚠️  WARNING: Binance flag is ENABLED but service is not running!" -ForegroundColor Yellow
        $flagsOk = $false
    }
    
    if (!$health.features.binance -and $health.services.binance) {
        Write-Host "❌ ERROR: Binance flag is DISABLED but service is still running!" -ForegroundColor Red
        $flagsOk = $false
    }
    
    if ($health.features.deribit -and !$health.services.deribit) {
        Write-Host "⚠️  WARNING: Deribit flag is ENABLED but service is not running!" -ForegroundColor Yellow
        $flagsOk = $false
    }
    
    if (!$health.features.deribit -and $health.services.deribit) {
        Write-Host "❌ ERROR: Deribit flag is DISABLED but service is still running!" -ForegroundColor Red
        $flagsOk = $false
    }
    
    if ($flagsOk) {
        Write-Host "✅ All feature flags are correctly applied!`n" -ForegroundColor Green
    } else {
        Write-Host "`n⚠️  Feature flag mismatch detected!" -ForegroundColor Yellow
        Write-Host "Try restarting the server with .\stop.ps1 then .\start.ps1`n" -ForegroundColor Gray
    }
    
    # Show full health response
    Write-Host "Full Health Response:" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────────────────────" -ForegroundColor Gray
    $health | ConvertTo-Json -Depth 3
    Write-Host ""
    
} catch {
    Write-Host "❌ Cannot connect to backend" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "`nMake sure the backend is running:" -ForegroundColor Gray
    Write-Host "  .\start.ps1`n" -ForegroundColor White
    exit 1
}
