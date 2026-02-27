# Comprehensive Test Suite for PolyTrade Feature Flags & Start/Stop Scripts
# Tests all functionality before starting the full application

Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        POLYTRADE - COMPREHENSIVE TEST SUITE                 ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$projectDir = "c:\Users\markr\OneDrive\Documents\Mark Rusch\sandbox\PolyTrade"
Set-Location $projectDir

# Initialize counters as script-level variables
$script:testsPassed = 0
$script:testsFailed = 0

function Test-Result {
    param($Name, $Passed, $Message = "")
    if ($Passed) {
        Write-Host "  ✅ $Name" -ForegroundColor Green
        if ($Message) { Write-Host "     $Message" -ForegroundColor Gray }
        $script:testsPassed++
    } else {
        Write-Host "  ❌ $Name" -ForegroundColor Red
        if ($Message) { Write-Host "     $Message" -ForegroundColor Yellow }
        $script:testsFailed++
    }
}

# ═══════════════════════════════════════════════════════════════
# TEST 1: File Existence
# ═══════════════════════════════════════════════════════════════
Write-Host "TEST 1: Verifying required files exist..." -ForegroundColor Cyan

Test-Result "start.ps1 exists" (Test-Path "start.ps1")
Test-Result "stop.ps1 exists" (Test-Path "stop.ps1")
Test-Result "server.ts exists" (Test-Path "server.ts")
Test-Result "package.json exists" (Test-Path "package.json")
Test-Result ".env.example exists" (Test-Path ".env.example")
Test-Result "FEATURE_FLAGS.md exists" (Test-Path "FEATURE_FLAGS.md")

# ═══════════════════════════════════════════════════════════════
# TEST 2: Configuration Files
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 2: Checking configuration files..." -ForegroundColor Cyan

$schemaContent = Get-Content "src\lib\config\schema.ts" -Raw
Test-Result "FeaturesConfigSchema exists" ($schemaContent -match "FeaturesConfigSchema")
Test-Result "binance feature flag defined" ($schemaContent -match "binance.*boolean")
Test-Result "deribit feature flag defined" ($schemaContent -match "deribit.*boolean")

$loaderContent = Get-Content "src\lib\config\loader.ts" -Raw
Test-Result "ENABLE_BINANCE env var mapped" ($loaderContent -match "ENABLE_BINANCE")
Test-Result "ENABLE_DERIBIT env var mapped" ($loaderContent -match "ENABLE_DERIBIT")

$envContent = Get-Content ".env.example" -Raw
Test-Result "ENABLE_BINANCE in .env.example" ($envContent -match "ENABLE_BINANCE")
Test-Result "ENABLE_DERIBIT in .env.example" ($envContent -match "ENABLE_DERIBIT")

# ═══════════════════════════════════════════════════════════════
# TEST 3: TypeScript Compilation
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 3: TypeScript compilation..." -ForegroundColor Cyan

$buildOutput = npm run build 2>&1 | Out-String
$hasErrors = $buildOutput -match "error TS"
Test-Result "TypeScript compiles without errors" (!$hasErrors) $(if ($hasErrors) { "Check build output for details" } else { "Clean build" })

# ═══════════════════════════════════════════════════════════════
# TEST 4: Start Script Validation
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 4: Start script validation..." -ForegroundColor Cyan

$startContent = Get-Content "start.ps1" -Raw
Test-Result "start.ps1 kills old processes" ($startContent -match "Stop-Process.*node")
Test-Result "start.ps1 sets env vars" ($startContent -match "POLYMARKET_FUNDER_ADDRESS")
Test-Result "start.ps1 sets feature flags" ($startContent -match "ENABLE_BINANCE")
Test-Result "start.ps1 starts backend" ($startContent -match "npm.*run.*server")
Test-Result "start.ps1 starts UI" ($startContent -match "npm.*run.*dev")
Test-Result "start.ps1 shows port 5173" ($startContent -match "5173")

# ═══════════════════════════════════════════════════════════════
# TEST 5: Stop Script Validation
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 5: Stop script validation..." -ForegroundColor Cyan

$stopContent = Get-Content "stop.ps1" -Raw
Test-Result "stop.ps1 kills node processes" ($stopContent -match "Stop-Process.*node")
Test-Result "stop.ps1 shows feedback" ($stopContent -match "ALL SERVICES STOPPED")

# ═══════════════════════════════════════════════════════════════
# TEST 6: UI Integration
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 6: UI shutdown integration..." -ForegroundColor Cyan

$appContent = Get-Content "ui\src\App.tsx" -Raw
Test-Result "UI has stop button" ($appContent -match "handleKillServers")
Test-Result "UI calls /api/shutdown" ($appContent -match "/api/shutdown")
Test-Result "UI shows confirmation dialog" ($appContent -match "window.confirm")

# ═══════════════════════════════════════════════════════════════
# TEST 7: Backend Shutdown Endpoint
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 7: Backend shutdown endpoint..." -ForegroundColor Cyan

$serverContent = Get-Content "server.ts" -Raw
Test-Result "Shutdown endpoint exists" ($serverContent -match "app.post.*'/api/shutdown'")
Test-Result "Shutdown calls process.exit" ($serverContent -match "process.exit")

# ═══════════════════════════════════════════════════════════════
# TEST 8: Feature Flag Implementation
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 8: Feature flag implementation in server..." -ForegroundColor Cyan

Test-Result "Binance wrapped in feature check" ($serverContent -match "if.*appConfig.features.binance")
Test-Result "Deribit wrapped in feature check" ($serverContent -match "if.*appConfig.features.deribit")
Test-Result "Disabled services logged" ($serverContent -match "Binance disabled")

# ═══════════════════════════════════════════════════════════════
# TEST 9: Health Check Enhancement
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 9: Health check feature flag support..." -ForegroundColor Cyan

Test-Result "Health returns features object" ($serverContent -match "features:")
Test-Result "Health checks binance status" ($serverContent -match "binance.*appConfig.features.binance")
Test-Result "Health checks deribit status" ($serverContent -match "deribit.*appConfig.features.deribit")

# ═══════════════════════════════════════════════════════════════
# TEST 10: UI Simplification
# ═══════════════════════════════════════════════════════════════
Write-Host "`nTEST 10: UI orderbook-only mode..." -ForegroundColor Cyan

$dashboardContent = Get-Content "ui\src\components\TradingDashboard.tsx" -Raw
Test-Result "LivePricing removed" (!($dashboardContent -match "import.*LivePricing"))
Test-Result "LivePricingCard removed" (!($dashboardContent -match "LivePricingCard"))
Test-Result "Binance badge removed" (!($dashboardContent -match "badge.*binance"))
Test-Result "Deribit badge removed" (!($dashboardContent -match "badge.*deribit"))

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════
Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor $(if ($testsFailed -eq 0) { "Green" } else { "Yellow" })
Write-Host "║                      TEST SUMMARY                            ║" -ForegroundColor $(if ($testsFailed -eq 0) { "Green" } else { "Yellow" })
Write-Host "╠══════════════════════════════════════════════════════════════╣" -ForegroundColor $(if ($testsFailed -eq 0) { "Green" } else { "Yellow" })
Write-Host "║  Tests Passed: $($testsPassed.ToString().PadLeft(2))                                               ║" -ForegroundColor Green
Write-Host "║  Tests Failed: $($testsFailed.ToString().PadLeft(2))                                               ║" -ForegroundColor $(if ($testsFailed -eq 0) { "Green" } else { "Red" })
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor $(if ($testsFailed -eq 0) { "Green" } else { "Yellow" })

if ($testsFailed -eq 0) {
    Write-Host "`n✅ ALL TESTS PASSED! Ready to start application.`n" -ForegroundColor Green
    Write-Host "To start the application, run:" -ForegroundColor Cyan
    Write-Host "  .\start.ps1`n" -ForegroundColor White
    
    Write-Host "To test with different feature flags:" -ForegroundColor Cyan
    Write-Host "  `$env:ENABLE_BINANCE='false'; `$env:ENABLE_DERIBIT='false'; .\start.ps1`n" -ForegroundColor White
} else {
    Write-Host "`n⚠️  Some tests failed. Please review and fix before starting.`n" -ForegroundColor Yellow
    exit 1
}

Pop-Location
