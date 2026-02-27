# PolyTrade Start Script - Orchestrated Service Launcher
# Usage: .\start.ps1 [-Services <name1,name2>] [-SkipPreflight] [-KillConflicts] [-Verbose]
# Version: 2.0.0 - PID-tracked, preflight-checked orchestration

param(
    [string]$Services = "",        # Comma-separated list of services to start (default: all)
    [switch]$SkipPreflight,        # Skip preflight checks (not recommended)
    [switch]$VerboseOutput,        # Show detailed output
    [switch]$KillConflicts         # Attempt to auto-stop processes on required ports
)

$ErrorActionPreference = "Stop"

# === Banner ===
Write-Host @"

╔═══════════════════════════════════════════════════════════════╗
║              POLYTRADE - SERVICE ORCHESTRATOR                ║
║                     v2.0.0 - PID Tracked                     ║
╚═══════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

# === Setup ===
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Load orchestration utilities (inline for compatibility)
$lockFilePath = Join-Path $scriptDir "process-lock.json"
$registryPath = Join-Path $scriptDir "service-registry.json"

# === Helper Functions ===
function Get-ProcessLock {
    if (Test-Path $lockFilePath) {
        try {
            return Get-Content $lockFilePath -Raw | ConvertFrom-Json
        } catch {
            return $null
        }
    }
    return $null
}

function Set-ProcessLock {
    param([object]$LockData)
    $tempPath = "$lockFilePath.tmp"
    $LockData | ConvertTo-Json -Depth 10 | Out-File -FilePath $tempPath -Encoding UTF8
    Move-Item -Path $tempPath -Destination $lockFilePath -Force
}

function Remove-ProcessLock {
    if (Test-Path $lockFilePath) {
        Remove-Item $lockFilePath -Force
    }
}

function Test-PortAvailable {
    param([int]$Port)
    # Only check for LISTEN state - TIME_WAIT and other states are OK
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return ($null -eq $connection)
}

function Stop-PortListeners {
    param(
        [int]$Port,
        [string[]]$AllowedProcessNames = @('node', 'npm', 'pnpm', 'bun', 'deno')
    )
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if (-not $listeners) { return $false }
    $stoppedAny = $false
    foreach ($procId in $listeners) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction Stop
            if ($AllowedProcessNames -contains $proc.ProcessName.ToLower()) {
                Write-Host "  [CLEAN] Stopping process $($proc.ProcessName) (PID $procId) on port $Port" -ForegroundColor Yellow
                Stop-Process -Id $procId -Force -ErrorAction Stop
                $stoppedAny = $true
            } else {
                Write-Host "  [SKIP] Port $Port owned by $($proc.ProcessName) (PID $procId) - not in allowed kill list" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  [WARN] Failed to stop PID $procId on port $($Port): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    return $stoppedAny
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

# === Load Service Registry ===
Write-Host "[CONFIG] Loading service registry..." -ForegroundColor Gray
if (-not (Test-Path $registryPath)) {
    Write-Host "[ERROR] Service registry not found: $registryPath" -ForegroundColor Red
    exit 1
}

try {
    $registry = Get-Content $registryPath -Raw | ConvertFrom-Json
    Write-Host "  Loaded $($registry.services.Count) service(s)" -ForegroundColor Gray
} catch {
    Write-Host "[ERROR] Invalid service registry JSON: $_" -ForegroundColor Red
    exit 1
}

# === Determine Which Services to Start ===
$servicesToStart = $registry.services
if ($Services -ne "") {
    $requestedNames = $Services -split "," | ForEach-Object { $_.Trim().ToLower() }
    $servicesToStart = $registry.services | Where-Object { $requestedNames -contains $_.name.ToLower() }
    if ($servicesToStart.Count -eq 0) {
        Write-Host "[ERROR] No matching services found for: $Services" -ForegroundColor Red
        $availNames = ($registry.services | ForEach-Object { $_.name }) -join ', '
        Write-Host "  Available: $availNames" -ForegroundColor Gray
        exit 1
    }
}

$startNames = ($servicesToStart | ForEach-Object { $_.name }) -join ', '
Write-Host "[SERVICES] Will start: $startNames" -ForegroundColor Cyan

# === Preflight Checks ===
if (-not $SkipPreflight) {
    Write-Host "`n[PREFLIGHT] Running checks..." -ForegroundColor Cyan
    $preflightPassed = $true
    $warnings = @()
    
    # Check for existing lock with live processes
    $lock = Get-ProcessLock
    if ($lock -and $lock.services) {
        $aliveServices = $lock.services | Where-Object { Test-ProcessAlive -ProcessId $_.pid }
        if ($aliveServices.Count -gt 0) {
            Write-Host "  [ERROR] Services already running:" -ForegroundColor Red
            foreach ($svc in $aliveServices) {
                Write-Host "    - $($svc.name) (PID $($svc.pid)) on port $($svc.port)" -ForegroundColor Red
            }
            Write-Host "`n  Run .\stop.ps1 first, or use -SkipPreflight to force" -ForegroundColor Yellow
            exit 1
        } else {
            Write-Host "  [WARN] Stale lock file found, cleaning up..." -ForegroundColor Yellow
            Remove-ProcessLock
        }
    }
    Write-Host "  [OK] No conflicting processes" -ForegroundColor Green
    
    # Check node_modules
    $backendModules = Join-Path $projectRoot "node_modules"
    $uiModules = Join-Path $projectRoot "ui\node_modules"
    if (-not (Test-Path $backendModules)) {
        Write-Host "  [ERROR] Missing node_modules in project root" -ForegroundColor Red
        Write-Host "    Run: npm install" -ForegroundColor Gray
        $preflightPassed = $false
    }
    if (-not (Test-Path $uiModules)) {
        Write-Host "  [ERROR] Missing node_modules in ui/" -ForegroundColor Red
        Write-Host "    Run: cd ui && npm install" -ForegroundColor Gray
        $preflightPassed = $false
    }
    if ((Test-Path $backendModules) -and (Test-Path $uiModules)) {
        Write-Host "  [OK] node_modules present" -ForegroundColor Green
    }
    
    # Check ports
    foreach ($svc in $servicesToStart) {
        $portFree = Test-PortAvailable -Port $svc.port
        if (-not $portFree -and $KillConflicts) {
            # Attempt to stop dev-related listeners occupying the port
            $killed = Stop-PortListeners -Port $svc.port
            Start-Sleep -Seconds 1
            $portFree = Test-PortAvailable -Port $svc.port
            if ($killed -and $portFree) {
                Write-Host "  [OK] Port $($svc.port) freed for $($svc.name)" -ForegroundColor Green
            }
        }

        if (-not $portFree) {
            Write-Host "  [ERROR] Port $($svc.port) in use (needed for $($svc.name))" -ForegroundColor Red
            $preflightPassed = $false
        } else {
            Write-Host "  [OK] Port $($svc.port) available ($($svc.name))" -ForegroundColor Green
        }
    }
    
    # Check .env (soft warning)
    $envPath = Join-Path $projectRoot ".env"
    if (-not (Test-Path $envPath)) {
        $warnings += ".env file not found - using defaults"
    } else {
        Write-Host "  [OK] .env file present" -ForegroundColor Green
    }
    
    if (-not $preflightPassed) {
        Write-Host "`n[PREFLIGHT FAILED] Fix errors above before starting" -ForegroundColor Red
        exit 1
    }
    
    if ($warnings.Count -gt 0) {
        Write-Host "`n[WARNINGS]:" -ForegroundColor Yellow
        foreach ($w in $warnings) {
            Write-Host "  - $w" -ForegroundColor Yellow
        }
    }
    
    Write-Host "`n[PREFLIGHT PASSED]" -ForegroundColor Green
} else {
    Write-Host "`n[PREFLIGHT] Skipped (--SkipPreflight)" -ForegroundColor Yellow
}

# === Set Global Environment Variables ===
Write-Host "`n[ENVIRONMENT] Setting variables..." -ForegroundColor Cyan
foreach ($prop in $registry.globalEnv.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($prop.Name, $prop.Value, "Process")
    Write-Host "  $($prop.Name) = $($prop.Value.Substring(0, [Math]::Min(20, $prop.Value.Length)))..." -ForegroundColor Gray
}

# Feature flags with defaults
foreach ($prop in $registry.featureFlags.PSObject.Properties) {
    $currentVal = [Environment]::GetEnvironmentVariable($prop.Name, "Process")
    if (-not $currentVal) {
        [Environment]::SetEnvironmentVariable($prop.Name, $prop.Value.default, "Process")
    }
    $finalVal = [Environment]::GetEnvironmentVariable($prop.Name, "Process")
    Write-Host "  $($prop.Name) = $finalVal" -ForegroundColor Gray
}

# === Initialize Lock File ===
$lockData = @{
    startedAt = (Get-Date).ToString("o")
    projectRoot = $projectRoot
    services = @()
}

# === Start Services (in dependency order) ===
Write-Host "`n[STARTING SERVICES]" -ForegroundColor Cyan

# Sort by dependencies (simple topological sort)
$started = @()
$toStart = [System.Collections.ArrayList]@($servicesToStart)

while ($toStart.Count -gt 0) {
    $canStart = $toStart | Where-Object {
        $deps = $_.dependsOn
        if (-not $deps -or $deps.Count -eq 0) { return $true }
        foreach ($dep in $deps) {
            if ($started -notcontains $dep) { return $false }
        }
        return $true
    } | Select-Object -First 1
    
    if (-not $canStart) {
        Write-Host "[ERROR] Circular dependency detected" -ForegroundColor Red
        exit 1
    }
    
    $svc = $canStart
    $toStart.Remove($svc) | Out-Null
    
    # Build command
    $svcCwd = if ($svc.cwd -eq ".") { $projectRoot } else { Join-Path $projectRoot $svc.cwd }
    $cmdArgs = $svc.args -join " "
    $fullCommand = "$($svc.command) $cmdArgs"
    
    Write-Host "`n  [$($svc.name.ToUpper())] $($svc.displayName)" -ForegroundColor White
    Write-Host "    Directory: $svcCwd" -ForegroundColor Gray
    Write-Host "    Command: $fullCommand" -ForegroundColor Gray
    Write-Host "    Port: $($svc.port)" -ForegroundColor Gray
    
    # Build environment for subprocess
    $envBlock = @()
    foreach ($prop in $registry.globalEnv.PSObject.Properties) {
        $envBlock += "`$env:$($prop.Name) = '$($prop.Value)'"
    }
    foreach ($prop in $registry.featureFlags.PSObject.Properties) {
        $val = [Environment]::GetEnvironmentVariable($prop.Name, "Process")
        $envBlock += "`$env:$($prop.Name) = '$val'"
    }
    if ($svc.env) {
        foreach ($prop in $svc.env.PSObject.Properties) {
            $envBlock += "`$env:$($prop.Name) = '$($prop.Value)'"
        }
    }
    $envSetup = $envBlock -join "; "
    
    $processCommand = "cd '$svcCwd'; $envSetup; $fullCommand"
    
    # Start process
    $proc = Start-Process powershell -ArgumentList @("-NoExit", "-Command", $processCommand) -PassThru
    
    if ($proc) {
        $lockData.services += @{
            name = $svc.name
            displayName = $svc.displayName
            pid = $proc.Id
            command = $fullCommand
            cwd = $svcCwd
            port = $svc.port
            startedAt = (Get-Date).ToString("o")
        }
        Write-Host "    [OK] Started (PID: $($proc.Id))" -ForegroundColor Green
        $started += $svc.name
        
        # Wait for initialization
        if ($svc.startupWait -gt 0) {
            Write-Host "    Waiting $($svc.startupWait)s for initialization..." -ForegroundColor Gray
            Start-Sleep $svc.startupWait
        }
    } else {
        Write-Host "    [ERROR] Failed to start $($svc.name)" -ForegroundColor Red
        # Stop any already-started services
        Write-Host "`n[ROLLBACK] Stopping already-started services..." -ForegroundColor Yellow
        foreach ($startedSvc in $lockData.services) {
            Stop-Process -Id $startedSvc.pid -Force -ErrorAction SilentlyContinue
        }
        Remove-ProcessLock
        exit 1
    }
}

# === Save Lock File ===
Set-ProcessLock $lockData

# === Summary ===
Write-Host @"

╔═══════════════════════════════════════════════════════════════╗
║                    SERVICES STARTED                          ║
╠═══════════════════════════════════════════════════════════════╣
"@ -ForegroundColor Green

foreach ($svc in $lockData.services) {
    $url = "http://localhost:$($svc.port)"
    Write-Host "║  $($svc.displayName.PadRight(25)) $url" -ForegroundColor Green
}

Write-Host @"
╠═══════════════════════════════════════════════════════════════╣
║  WebSocket: ws://localhost:3003/ws                           ║
╠═══════════════════════════════════════════════════════════════╣
║  Stop:   .\stop.ps1                                          ║
║  Status: .\status.ps1                                        ║
╚═══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Green
