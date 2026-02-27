# PolyTrade Stop Script - PID-Targeted Service Shutdown
# Usage: .\stop.ps1 [-Services <name1,name2>] [-Force] [-CleanAll]
# Version: 2.0.0 - Stops only tracked PIDs from lock file

param(
    [string]$Services = "",      # Comma-separated list of services to stop (default: all)
    [switch]$Force,              # Force kill without graceful shutdown
    [switch]$CleanAll            # Also kill any stray node processes (old behavior)
)

$ErrorActionPreference = "Continue"

# === Banner ===
Write-Host @"

╔═══════════════════════════════════════════════════════════════╗
║              POLYTRADE - SERVICE SHUTDOWN                    ║
║                     v2.0.0 - PID Targeted                    ║
╚═══════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Yellow

# === Setup ===
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$lockFilePath = Join-Path $scriptDir "process-lock.json"

# === Helper Functions ===
function Get-ProcessLock {
    if (Test-Path $lockFilePath) {
        try {
            return Get-Content $lockFilePath -Raw | ConvertFrom-Json
        } catch {
            Write-Host "[WARN] Corrupted lock file" -ForegroundColor Yellow
            return $null
        }
    }
    return $null
}

function Remove-ProcessLock {
    if (Test-Path $lockFilePath) {
        Remove-Item $lockFilePath -Force
        Write-Host "[OK] Lock file removed" -ForegroundColor Green
    }
}

function Test-ProcessAlive {
    param([int]$ProcessId)
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
        return ($null -ne $proc)
    } catch {
        return $false
    }
}

function Stop-ServiceByPid {
    param(
        [int]$ProcessId,
        [string]$Name,
        [switch]$Force
    )
    
    if (-not (Test-ProcessAlive -ProcessId $ProcessId)) {
        Write-Host "  [$Name] Already stopped (PID $ProcessId was not running)" -ForegroundColor Gray
        return $true
    }
    
    Write-Host "  [$Name] Stopping PID $ProcessId..." -ForegroundColor Yellow
    
    try {
        if ($Force) {
            Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        } else {
            # Try graceful first
            Stop-Process -Id $ProcessId -ErrorAction Stop
            Start-Sleep 2
            
            # Force if still alive
            if (Test-ProcessAlive -ProcessId $ProcessId) {
                Write-Host "    Graceful shutdown timeout, forcing..." -ForegroundColor Yellow
                Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
                Start-Sleep 1
            }
        }
        
        if (Test-ProcessAlive -ProcessId $ProcessId) {
            Write-Host "    [WARN] Process may still be running" -ForegroundColor Yellow
            return $false
        }
        
        Write-Host "    [OK] Stopped" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "    [ERROR] $_" -ForegroundColor Red
        return $false
    }
}

# === Load Lock File ===
Write-Host "[LOCK] Reading process lock file..." -ForegroundColor Gray
$lock = Get-ProcessLock

if (-not $lock -or -not $lock.services -or $lock.services.Count -eq 0) {
    Write-Host "[INFO] No lock file or no tracked services found" -ForegroundColor Gray
    
    if ($CleanAll) {
        Write-Host "`n[CLEAN] Checking for any stray node processes..." -ForegroundColor Yellow
        $strayProcs = Get-Process -Name node -ErrorAction SilentlyContinue
        if ($strayProcs) {
            $count = ($strayProcs | Measure-Object).Count
            Write-Host "  Found $count stray node process(es)" -ForegroundColor Yellow
            Stop-Process -Name node -Force -ErrorAction SilentlyContinue
            Start-Sleep 2
            Write-Host "  [OK] Stray processes stopped" -ForegroundColor Green
        } else {
            Write-Host "  [OK] No stray processes found" -ForegroundColor Green
        }
    } else {
        Write-Host "`n[TIP] Use -CleanAll to stop any stray node processes" -ForegroundColor Gray
    }
    
    Remove-ProcessLock
    Write-Host "`n[DONE] Shutdown complete" -ForegroundColor Green
    exit 0
}

# === Determine Which Services to Stop ===
$servicesToStop = $lock.services
if ($Services -ne "") {
    $requestedNames = $Services -split "," | ForEach-Object { $_.Trim().ToLower() }
    $servicesToStop = $lock.services | Where-Object { $requestedNames -contains $_.name.ToLower() }
    if ($servicesToStop.Count -eq 0) {
        Write-Host "[WARN] No matching services in lock file for: $Services" -ForegroundColor Yellow
        $trackedNames = ($lock.services | ForEach-Object { $_.name }) -join ', '
        Write-Host "  Tracked: $trackedNames" -ForegroundColor Gray
        exit 1
    }
}

# === Show Status ===
Write-Host "`n[STATUS] Services tracked in lock file:" -ForegroundColor Cyan
$lock.services | ForEach-Object {
    $alive = if (Test-ProcessAlive -ProcessId $_.pid) { "[RUNNING]" } else { "[DEAD]" }
    $color = if ($alive -eq "[RUNNING]") { "Green" } else { "Gray" }
    Write-Host "  $($_.name.PadRight(15)) PID $($_.pid.ToString().PadRight(6)) Port $($_.port) $alive" -ForegroundColor $color
}

# === Stop Services (reverse dependency order) ===
Write-Host "`n[STOPPING] Shutting down services..." -ForegroundColor Yellow

# Stop in reverse order (UI first, then backend)
$reverseServices = [array]$servicesToStop
[array]::Reverse($reverseServices)

$allStopped = $true
foreach ($svc in $reverseServices) {
    $result = Stop-ServiceByPid -ProcessId $svc.pid -Name $svc.name -Force:$Force
    if (-not $result) {
        $allStopped = $false
    }
}

# === Clean Stray Processes (if requested) ===
if ($CleanAll) {
    Write-Host "`n[CLEAN] Checking for stray node processes..." -ForegroundColor Yellow
    $strayProcs = Get-Process -Name node -ErrorAction SilentlyContinue
    if ($strayProcs) {
        $count = ($strayProcs | Measure-Object).Count
        Write-Host "  Found $count additional node process(es)" -ForegroundColor Yellow
        Stop-Process -Name node -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
        Write-Host "  [OK] Stray processes stopped" -ForegroundColor Green
    } else {
        Write-Host "  [OK] No stray processes" -ForegroundColor Green
    }
}

# === Update/Remove Lock File ===
if ($Services -ne "" -and $servicesToStop.Count -lt $lock.services.Count) {
    # Partial stop - update lock file to remove stopped services
    $stoppedNames = $servicesToStop | ForEach-Object { $_.name }
    $remainingServices = $lock.services | Where-Object { $stoppedNames -notcontains $_.name }
    $lock.services = @($remainingServices)
    $lock | ConvertTo-Json -Depth 10 | Out-File -FilePath $lockFilePath -Encoding UTF8
    $remainNames = ($remainingServices | ForEach-Object { $_.name }) -join ', '
    Write-Host "`n[LOCK] Updated lock file (remaining: $remainNames)" -ForegroundColor Gray
} else {
    # Full stop - remove lock file
    Remove-ProcessLock
}

# === Summary ===
if ($allStopped) {
    Write-Host @"

╔═══════════════════════════════════════════════════════════════╗
║                 ALL SERVICES STOPPED                         ║
╚═══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Green
} else {
    Write-Host @"

╔═══════════════════════════════════════════════════════════════╗
║           SHUTDOWN COMPLETE (with warnings)                  ║
╚═══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Yellow
    Write-Host "[TIP] Use -CleanAll -Force to forcefully stop all node processes" -ForegroundColor Gray
}
