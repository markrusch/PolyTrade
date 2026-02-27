# PolyTrade Launcher
# Usage: .\start.ps1 [start|stop|status|restart] [-Services backend,ui] [-Force]
#
# Commands:
#   start   - Start backend and frontend (default, auto-kills existing instances)
#   stop    - Stop all running services
#   status  - Show current service status
#   restart - Stop then start all services
#
# Options:
#   -Services  - Comma-separated list: backend, ui (default: both)
#   -Force     - Force stop without graceful shutdown
#   -CleanAll  - Also kill stray node processes on stop
#   -NoKill    - Don't auto-kill existing instances (will fail if ports in use)

param(
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "status", "restart", "")]
    [string]$Command = "start",

    [string]$Services = "",
    [switch]$Force,
    [switch]$CleanAll,
    [switch]$SkipPreflight,
    [switch]$NoKill  # By default, we auto-kill conflicting processes
)

$scriptDir = $PSScriptRoot
$scriptsDir = Join-Path $scriptDir "scripts"

# Banner
Write-Host @"

╔═══════════════════════════════════════════════════════════════╗
║                    POLYTRADE LAUNCHER                         ║
║                        v2.2.0                                 ║
╚═══════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

# Build switch parameters as hashtable for proper splatting
$startParams = @{}
$stopParams = @{}

if ($Services) {
    $startParams['Services'] = $Services
    $stopParams['Services'] = $Services
}
if ($Force) { $stopParams['Force'] = $true }
if ($CleanAll) { $stopParams['CleanAll'] = $true }
if ($SkipPreflight) { $startParams['SkipPreflight'] = $true }
# Auto-kill conflicting processes by default unless -NoKill is specified
if (-not $NoKill) { $startParams['KillConflicts'] = $true }

switch ($Command) {
    "start" {
        Write-Host "[ACTION] Starting services..." -ForegroundColor Green
        & "$scriptsDir\start.ps1" @startParams
    }

    "stop" {
        Write-Host "[ACTION] Stopping services..." -ForegroundColor Yellow
        & "$scriptsDir\stop.ps1" @stopParams
    }

    "status" {
        Write-Host "[ACTION] Checking status..." -ForegroundColor Cyan
        & "$scriptsDir\status.ps1"
    }

    "restart" {
        Write-Host "[ACTION] Restarting services..." -ForegroundColor Magenta
        Write-Host ""
        & "$scriptsDir\stop.ps1" @stopParams
        Write-Host ""
        Start-Sleep -Seconds 2
        & "$scriptsDir\start.ps1" @startParams
    }

    default {
        # Default to start
        Write-Host "[ACTION] Starting services..." -ForegroundColor Green
        & "$scriptsDir\start.ps1" @startParams
    }
}

Write-Host @"

╔═══════════════════════════════════════════════════════════════╗
║  Quick Commands:                                              ║
║    .\start.ps1              - Start services (auto-kills old) ║
║    .\start.ps1 stop         - Stop all services               ║
║    .\start.ps1 status       - Check service status            ║
║    .\start.ps1 restart      - Restart all services            ║
║    .\start.ps1 -NoKill      - Start without killing existing  ║
╚═══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Gray
