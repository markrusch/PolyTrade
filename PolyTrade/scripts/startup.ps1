# Complete Startup Workflow - Test, Start, and Verify
# Usage: .\startup.ps1

$ErrorActionPreference = "Stop"

Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║           POLYTRADE COMPLETE STARTUP WORKFLOW                ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$projectDir = "c:\Users\markr\OneDrive\Documents\Mark Rusch\sandbox\PolyTrade"
Set-Location $projectDir

# STEP 1: Run Tests
Write-Host "STEP 1: Running Test Suite..." -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════`n" -ForegroundColor Gray

& .\run-tests.ps1
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE) {
    Write-Host "`n❌ Tests failed! Please fix errors before continuing.`n" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ All tests passed!`n" -ForegroundColor Green
Start-Sleep 2

# STEP 2: Stop any existing services
Write-Host "STEP 2: Cleaning Up Old Processes..." -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════`n" -ForegroundColor Gray

& .\stop.ps1
Start-Sleep 2

# STEP 3: Start Services
Write-Host "`nSTEP 3: Starting Services..." -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════`n" -ForegroundColor Gray

& .\start.ps1

# STEP 4: Verify Feature Flags
Write-Host "`nSTEP 4: Verifying Feature Flags..." -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════`n" -ForegroundColor Gray

Start-Sleep 3
& .\verify-flags.ps1

# STEP 5: Summary
Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                  🚀 STARTUP COMPLETE!                        ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║                                                              ║" -ForegroundColor Green
Write-Host "║  Backend:  http://localhost:3003                             ║" -ForegroundColor Green
Write-Host "║  Frontend: http://localhost:5173                             ║" -ForegroundColor Green
Write-Host "║                                                              ║" -ForegroundColor Green
Write-Host "║  Two PowerShell windows are now running:                     ║" -ForegroundColor Green
Write-Host "║    1. Backend Server (shows logs)                            ║" -ForegroundColor Green
Write-Host "║    2. UI Dev Server (Vite)                                   ║" -ForegroundColor Green
Write-Host "║                                                              ║" -ForegroundColor Green
Write-Host "║  To stop: Click STOP button in UI or run .\stop.ps1         ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

Write-Host "Opening browser..." -ForegroundColor Cyan
Start-Sleep 2
Start-Process "http://localhost:5173"

Write-Host "`n✅ Application is ready!`n" -ForegroundColor Green
