# PolyTrade Orchestration Utilities
# Shared functions for start.ps1, stop.ps1, status.ps1

# === Configuration ===
$script:LockFilePath = Join-Path $PSScriptRoot "process-lock.json"
$script:RegistryPath = Join-Path $PSScriptRoot "service-registry.json"

# === Lock File Management ===
function Get-ProcessLock {
    if (Test-Path $script:LockFilePath) {
        try {
            $content = Get-Content $script:LockFilePath -Raw | ConvertFrom-Json
            return $content
        } catch {
            Write-Host "[WARN] Corrupted lock file, will be recreated" -ForegroundColor Yellow
            return $null
        }
    }
    return $null
}

function Set-ProcessLock {
    param([object]$LockData)
    $tempPath = "$($script:LockFilePath).tmp"
    $LockData | ConvertTo-Json -Depth 10 | Out-File -FilePath $tempPath -Encoding UTF8
    Move-Item -Path $tempPath -Destination $script:LockFilePath -Force
}

function Remove-ProcessLock {
    if (Test-Path $script:LockFilePath) {
        Remove-Item $script:LockFilePath -Force
    }
}

function Add-ServiceToLock {
    param(
        [string]$Name,
        [int]$ProcessId,
        [string]$Command,
        [string]$Cwd,
        [int]$Port
    )
    $lock = Get-ProcessLock
    if (-not $lock) {
        $lock = @{
            startedAt = (Get-Date).ToString("o")
            services = @()
        }
    }
    $lock.services += @{
        name = $Name
        pid = $ProcessId
        command = $Command
        cwd = $Cwd
        port = $Port
        startedAt = (Get-Date).ToString("o")
    }
    Set-ProcessLock $lock
}

# === Service Registry ===
function Get-ServiceRegistry {
    if (-not (Test-Path $script:RegistryPath)) {
        Write-Host "[ERROR] Service registry not found: $($script:RegistryPath)" -ForegroundColor Red
        return $null
    }
    try {
        return Get-Content $script:RegistryPath -Raw | ConvertFrom-Json
    } catch {
        Write-Host "[ERROR] Invalid service registry JSON" -ForegroundColor Red
        return $null
    }
}

# === Preflight Checks ===
function Test-PortAvailable {
    param([int]$Port)
    $connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    return ($null -eq $connection)
}

function Test-NodeModulesExist {
    param([string]$ProjectRoot)
    $backendModules = Join-Path $ProjectRoot "node_modules"
    $uiModules = Join-Path $ProjectRoot "ui\node_modules"
    $backendExists = Test-Path $backendModules
    $uiExists = Test-Path $uiModules
    return @{
        backend = $backendExists
        ui = $uiExists
        all = ($backendExists -and $uiExists)
    }
}

function Test-NpmScriptExists {
    param([string]$PackageJsonPath, [string]$ScriptName)
    if (-not (Test-Path $PackageJsonPath)) {
        return $false
    }
    try {
        $pkg = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
        return ($null -ne $pkg.scripts.$ScriptName)
    } catch {
        return $false
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

function Test-StaleLock {
    param([string]$ProjectRoot)
    $lock = Get-ProcessLock
    if (-not $lock) {
        return @{ stale = $false; deadPids = @() }
    }
    $deadPids = @()
    foreach ($svc in $lock.services) {
        if (-not (Test-ProcessAlive -Pid $svc.pid)) {
            $deadPids += $svc
        }
    }
    return @{
        stale = ($deadPids.Count -gt 0 -and $deadPids.Count -eq $lock.services.Count)
        partial = ($deadPids.Count -gt 0 -and $deadPids.Count -lt $lock.services.Count)
        deadPids = $deadPids
        alivePids = ($lock.services | Where-Object { Test-ProcessAlive -Pid $_.pid })
    }
}

function Invoke-PreflightChecks {
    param([string]$ProjectRoot, [object]$Registry)
    
    $errors = @()
    $warnings = @()
    
    Write-Host "`n[PREFLIGHT] Running preflight checks..." -ForegroundColor Cyan
    
    # Check for stale lock
    $staleLock = Test-StaleLock -ProjectRoot $ProjectRoot
    if ($staleLock.stale) {
        Write-Host "  [WARN] Stale lock file found (all processes dead), cleaning up..." -ForegroundColor Yellow
        Remove-ProcessLock
    } elseif ($staleLock.partial) {
        Write-Host "  [WARN] Partial stale lock - some processes dead:" -ForegroundColor Yellow
        foreach ($dead in $staleLock.deadPids) {
            Write-Host "    - $($dead.name) (PID $($dead.pid)) is dead" -ForegroundColor Yellow
        }
        $warnings += "Partial stale lock detected"
    } elseif ($staleLock.alivePids.Count -gt 0) {
        Write-Host "  [ERROR] Services already running from lock file:" -ForegroundColor Red
        foreach ($alive in $staleLock.alivePids) {
            Write-Host "    - $($alive.name) (PID $($alive.pid)) on port $($alive.port)" -ForegroundColor Red
        }
        $errors += "Services already running. Run stop.ps1 first."
    }
    
    # Check node_modules
    $modules = Test-NodeModulesExist -ProjectRoot $ProjectRoot
    if (-not $modules.backend) {
        $errors += "Missing node_modules in project root. Run: npm install"
    }
    if (-not $modules.ui) {
        $errors += "Missing node_modules in ui/. Run: cd ui && npm install"
    }
    if ($modules.all) {
        Write-Host "  [OK] node_modules present" -ForegroundColor Green
    }
    
    # Check npm scripts exist
    foreach ($svc in $Registry.services) {
        $pkgPath = if ($svc.cwd -eq ".") { 
            Join-Path $ProjectRoot "package.json" 
        } else { 
            Join-Path $ProjectRoot "$($svc.cwd)\package.json" 
        }
        $scriptName = $svc.args[1]  # "run" is args[0], script name is args[1]
        if (-not (Test-NpmScriptExists -PackageJsonPath $pkgPath -ScriptName $scriptName)) {
            $errors += "Missing npm script '$scriptName' in $pkgPath"
        }
    }
    if ($errors.Count -eq 0 -or $errors[-1] -notmatch "Missing npm script") {
        Write-Host "  [OK] npm scripts verified" -ForegroundColor Green
    }
    
    # Check ports available
    foreach ($svc in $Registry.services) {
        if (-not (Test-PortAvailable -Port $svc.port)) {
            $errors += "Port $($svc.port) is in use (needed for $($svc.name)). Run stop.ps1 or check for conflicting services."
        } else {
            Write-Host "  [OK] Port $($svc.port) available for $($svc.name)" -ForegroundColor Green
        }
    }
    
    # Soft checks: .env file
    $envPath = Join-Path $ProjectRoot ".env"
    if (-not (Test-Path $envPath)) {
        $warnings += ".env file not found - using defaults. Copy .env.example to .env for custom config."
    } else {
        Write-Host "  [OK] .env file present" -ForegroundColor Green
    }
    
    # Report results
    if ($errors.Count -gt 0) {
        Write-Host "`n[PREFLIGHT FAILED] Cannot start services:" -ForegroundColor Red
        foreach ($err in $errors) {
            Write-Host "  - $err" -ForegroundColor Red
        }
        return $false
    }
    
    if ($warnings.Count -gt 0) {
        Write-Host "`n[PREFLIGHT WARNINGS]:" -ForegroundColor Yellow
        foreach ($warn in $warnings) {
            Write-Host "  - $warn" -ForegroundColor Yellow
        }
    }
    
    Write-Host "`n[PREFLIGHT PASSED] All checks passed" -ForegroundColor Green
    return $true
}

# === Service Start/Stop ===
function Start-ServiceProcess {
    param(
        [string]$ProjectRoot,
        [object]$Service,
        [hashtable]$GlobalEnv
    )
    
    $svcCwd = if ($Service.cwd -eq ".") { $ProjectRoot } else { Join-Path $ProjectRoot $Service.cwd }
    $cmdArgs = $Service.args -join " "
    $fullCommand = "$($Service.command) $cmdArgs"
    
    # Build environment string for the new process
    $envCommands = @()
    foreach ($key in $GlobalEnv.Keys) {
        $envCommands += "`$env:$key = '$($GlobalEnv[$key])'"
    }
    if ($Service.env) {
        foreach ($prop in $Service.env.PSObject.Properties) {
            $envCommands += "`$env:$($prop.Name) = '$($prop.Value)'"
        }
    }
    $envSetup = $envCommands -join "; "
    
    $processCommand = "cd '$svcCwd'; $envSetup; $fullCommand"
    
    Write-Host "  Starting $($Service.displayName)..." -ForegroundColor Cyan
    Write-Host "    Command: $fullCommand" -ForegroundColor Gray
    Write-Host "    Directory: $svcCwd" -ForegroundColor Gray
    Write-Host "    Port: $($Service.port)" -ForegroundColor Gray
    
    $proc = Start-Process powershell -ArgumentList @("-NoExit", "-Command", $processCommand) -PassThru
    
    if ($proc) {
        Add-ServiceToLock -Name $Service.name -Pid $proc.Id -Command $fullCommand -Cwd $svcCwd -Port $Service.port
        Write-Host "    [OK] Started (PID: $($proc.Id))" -ForegroundColor Green
        
        # Wait for startup
        if ($Service.startupWait -gt 0) {
            Write-Host "    Waiting $($Service.startupWait)s for initialization..." -ForegroundColor Gray
            Start-Sleep $Service.startupWait
        }
        
        return $true
    } else {
        Write-Host "    [ERROR] Failed to start" -ForegroundColor Red
        return $false
    }
}

function Stop-ServiceProcess {
    param([object]$ServiceLock, [switch]$Force)
    
    Write-Host "  Stopping $($ServiceLock.name) (PID: $($ServiceLock.pid))..." -ForegroundColor Yellow
    
    if (-not (Test-ProcessAlive -Pid $ServiceLock.pid)) {
        Write-Host "    [OK] Already stopped" -ForegroundColor Gray
        return $true
    }
    
    try {
        Stop-Process -Id $ServiceLock.pid -Force:$Force -ErrorAction Stop
        Start-Sleep 1
        
        if (Test-ProcessAlive -Pid $ServiceLock.pid) {
            Write-Host "    [WARN] Process still alive, force killing..." -ForegroundColor Yellow
            Stop-Process -Id $ServiceLock.pid -Force -ErrorAction SilentlyContinue
            Start-Sleep 1
        }
        
        Write-Host "    [OK] Stopped" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "    [ERROR] Failed to stop: $_" -ForegroundColor Red
        return $false
    }
}

# Export for use in other scripts
Export-ModuleMember -Function * -Variable LockFilePath, RegistryPath
