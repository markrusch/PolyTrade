# PolyTrade Status Script - Service Health Monitor
# Usage: .\status.ps1 [-Watch] [-Json]
# Version: 2.0.0 - Reports status from lock file with health checks

param(
    [switch]$Watch,      # Continuously monitor (refresh every 5s)
    [switch]$Json        # Output as JSON for programmatic use
)

$ErrorActionPreference = "Continue"

# === Setup ===
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
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

function Get-ServiceRegistry {
    if (Test-Path $registryPath) {
        try {
            return Get-Content $registryPath -Raw | ConvertFrom-Json
        } catch {
            return $null
        }
    }
    return $null
}

function Test-ProcessAlive {
    param([int]$ProcessId)
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Test-PortListening {
    param([int]$PortNum)
    $connection = Get-NetTCPConnection -LocalPort $PortNum -ErrorAction SilentlyContinue
    return ($null -ne $connection)
}

function Test-HttpHealth {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        return @{
            healthy = ($response.StatusCode -eq 200)
            statusCode = $response.StatusCode
            error = $null
        }
    } catch {
        return @{
            healthy = $false
            statusCode = 0
            error = $_.Exception.Message
        }
    }
}

function Get-ServiceStatus {
    $lock = Get-ProcessLock
    $registry = Get-ServiceRegistry
    
    $status = [ordered]@{
        timestamp = (Get-Date).ToString("o")
        lockFileExists = (Test-Path $lockFilePath)
        startedAt = $null
        services = @()
        summary = [ordered]@{
            total = 0
            running = 0
            stopped = 0
            unhealthy = 0
        }
    }
    
    if (-not $lock -or -not $lock.services) {
        return $status
    }
    
    $status.startedAt = $lock.startedAt
    $status.summary.total = $lock.services.Count
    
    foreach ($svc in $lock.services) {
        $regEntry = $registry.services | Where-Object { $_.name -eq $svc.name }
        
        $procAlive = Test-ProcessAlive -ProcessId $svc.pid
        $portListen = Test-PortListening -PortNum $svc.port
        
        $svcStatus = [ordered]@{
            name = $svc.name
            displayName = $svc.displayName
            processId = $svc.pid
            portNumber = $svc.port
            command = $svc.command
            startedAt = $svc.startedAt
            processAlive = $procAlive
            portListening = $portListen
            healthy = $procAlive -and $portListen
            healthCheck = $null
        }
        
        # Health check if defined
        if ($regEntry -and $regEntry.healthCheck) {
            $health = Test-HttpHealth -Url $regEntry.healthCheck
            $svcStatus.healthCheck = [ordered]@{
                url = $regEntry.healthCheck
                healthy = $health.healthy
                details = if ($health.error) { $health.error } else { "HTTP $($health.statusCode)" }
            }
            $svcStatus.healthy = $health.healthy
        }
        
        # Update summary
        if ($svcStatus.processAlive) {
            $status.summary.running++
        } else {
            $status.summary.stopped++
        }
        if (-not $svcStatus.healthy) {
            $status.summary.unhealthy++
        }
        
        $status.services += $svcStatus
    }
    
    return $status
}

function Show-Status {
    param([object]$Status)
    
    if ($Json) {
        $Status | ConvertTo-Json -Depth 10
        return
    }
    
    # Clear screen for watch mode
    if ($Watch) {
        Clear-Host
    }
    
    Write-Host @"

╔═══════════════════════════════════════════════════════════════╗
║              POLYTRADE - SERVICE STATUS                      ║
╚═══════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan
    
    Write-Host "Timestamp: $($Status.timestamp)" -ForegroundColor Gray
    
    if (-not $Status.lockFileExists) {
        Write-Host "`n[INFO] No services currently tracked" -ForegroundColor Yellow
        Write-Host "  Run .\start.ps1 to start services" -ForegroundColor Gray
        
        # Check for any stray node processes
        $stray = Get-Process -Name node -ErrorAction SilentlyContinue
        if ($stray) {
            Write-Host "`n[WARN] Found $($stray.Count) untracked node process(es)" -ForegroundColor Yellow
            Write-Host "  Run .\stop.ps1 -CleanAll to clean up" -ForegroundColor Gray
        }
        return
    }
    
    Write-Host "Started: $($Status.startedAt)" -ForegroundColor Gray
    
    # Summary bar
    $summaryColor = if ($Status.summary.unhealthy -gt 0) { "Yellow" } 
                    elseif ($Status.summary.stopped -gt 0) { "Red" } 
                    else { "Green" }
    Write-Host "`n[SUMMARY] " -NoNewline
    Write-Host "Running: $($Status.summary.running)/$($Status.summary.total)" -ForegroundColor $summaryColor -NoNewline
    if ($Status.summary.unhealthy -gt 0) {
        Write-Host " | Unhealthy: $($Status.summary.unhealthy)" -ForegroundColor Yellow
    } else {
        Write-Host ""
    }
    
    # Service details
    Write-Host "`n[SERVICES]" -ForegroundColor Cyan
    Write-Host "---------------------------------------------------------------" -ForegroundColor Gray
    
    foreach ($svc in $Status.services) {
        # Status indicator
        $indicator = if ($svc.healthy) { "[OK]" } elseif ($svc.processAlive) { "[!!]" } else { "[XX]" }
        $color = if ($svc.healthy) { "Green" } elseif ($svc.processAlive) { "Yellow" } else { "Red" }
        
        Write-Host "  $indicator " -ForegroundColor $color -NoNewline
        Write-Host "$($svc.displayName)" -ForegroundColor White
        
        # Details
        $pidStatus = if ($svc.processAlive) { "running" } else { "dead" }
        $portStatus = if ($svc.portListening) { "listening" } else { "closed" }
        Write-Host "      PID: $($svc.processId) ($pidStatus) | Port: $($svc.portNumber) ($portStatus)" -ForegroundColor Gray
        
        if ($svc.healthCheck) {
            $healthColor = if ($svc.healthCheck.healthy) { "Green" } else { "Red" }
            Write-Host "      Health: " -ForegroundColor Gray -NoNewline
            Write-Host "$($svc.healthCheck.details)" -ForegroundColor $healthColor
        }
        
        Write-Host ""
    }
    
    # Quick actions
    Write-Host "---------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "[ACTIONS]" -ForegroundColor Cyan
    Write-Host "  .\stop.ps1              Stop all services" -ForegroundColor Gray
    Write-Host "  .\stop.ps1 -Services ui Stop specific service" -ForegroundColor Gray
    Write-Host "  .\start.ps1             Restart all services" -ForegroundColor Gray
    
    if ($Watch) {
        Write-Host "`n[WATCH MODE] Refreshing every 5 seconds. Press Ctrl+C to exit." -ForegroundColor Yellow
    }
}

# === Main ===
if ($Watch) {
    while ($true) {
        $status = Get-ServiceStatus
        Show-Status -Status $status
        Start-Sleep 5
    }
} else {
    $status = Get-ServiceStatus
    Show-Status -Status $status
}
