# Simple Test Runner - Executes run-tests.ps1 and displays results
# Usage: .\test.ps1

Write-Host "`n════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Running PolyTrade Test Suite..." -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

$projectDir = "c:\Users\markr\OneDrive\Documents\Mark Rusch\sandbox\PolyTrade"
Set-Location $projectDir

# Execute the test suite
& .\run-tests.ps1

# Check exit code
if ($LASTEXITCODE -eq 0 -or !$LASTEXITCODE) {
    Write-Host "`n✅ Test suite completed successfully!" -ForegroundColor Green
    Write-Host "`nYou can now start the application:" -ForegroundColor Cyan
    Write-Host "  .\start.ps1`n" -ForegroundColor White
    exit 0
} else {
    Write-Host "`n❌ Test suite failed!" -ForegroundColor Red
    Write-Host "`nPlease fix the errors above before starting.`n" -ForegroundColor Yellow
    exit 1
}
