<#
.SYNOPSIS
    One-command setup + launch for OCPP Certification Dashboard.
    Run this after git clone on ANY machine.
.DESCRIPTION
    Automates:
      1. Check Node.js is installed
      2. npm install if needed
      3. Install Playwright Chromium browser if missing
      4. Create dashboard-config.json from example if missing
      5. Start the server
      6. Open browser
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSCommandPath
$LogFile = Join-Path $ProjectRoot "logs\startup.log"
$ConfigFile = Join-Path $ProjectRoot "dashboard-config.json"
$ExampleFile = Join-Path $ProjectRoot "dashboard-config.example.json"

# Ensure logs directory
New-Item -ItemType Directory -Path (Join-Path $ProjectRoot "logs") -Force | Out-Null

function Log { param([string]$Msg) $timestamp = Get-Date -Format "HH:mm:ss"; Write-Host "[$timestamp] $Msg" -ForegroundColor Cyan }

# ── 1. Check Node.js ──
try {
    $nodeVer = node --version
    Log "✅ Node.js $nodeVer"
} catch {
    Write-Host "`n❌ Node.js is NOT installed!" -ForegroundColor Red
    Write-Host "   Download from: https://nodejs.org (LTS recommended)`n" -ForegroundColor Yellow
    Start-Process "https://nodejs.org"
    exit 1
}

# ── 2. npm install ──
if (!(Test-Path (Join-Path $ProjectRoot "node_modules\tsx"))) {
    Log "📦 Installing dependencies (npm install)..."
    Push-Location $ProjectRoot
    npm install 2>&1 | Out-File -FilePath $LogFile -Append
    Pop-Location
    Log "✅ Dependencies installed"
} else {
    Log "✅ Dependencies already installed"
}

# ── 3. Playwright browser ──
$pwCache = "$env:USERPROFILE\AppData\Local\ms-playwright"
if (!(Test-Path $pwCache)) {
    Log "🎭 Installing Playwright Chromium browser..."
    Push-Location $ProjectRoot
    npx playwright install chromium 2>&1 | Out-File -FilePath $LogFile -Append
    Pop-Location
    Log "✅ Playwright Chromium installed"
} else {
    Log "✅ Playwright Chromium already installed"
}

# ── 4. Dashboard config ──
if (!(Test-Path $ConfigFile)) {
    if (Test-Path $ExampleFile) {
        Copy-Item $ExampleFile $ConfigFile
        Log "📋 Created dashboard-config.json from example template"
        Write-Host "`n⚠️  EDIT NEEDED:" -ForegroundColor Yellow
        Write-Host "   Open dashboard-config.json and set your OCTT token and CDS IP.`n" -ForegroundColor Gray
        notepad $ConfigFile
        Write-Host "   Press Enter after editing..." -ForegroundColor Gray
        Read-Host
    } else {
        Log "⚠️  No dashboard-config.example.json found, starting with defaults"
    }
} else {
    Log "✅ Config file exists"
}

# ── 5. Check if already running ──
$tcp = [System.Net.Sockets.TcpClient]::new()
try {
    $tcp.Connect("127.0.0.1", 3101)
    $tcp.Close()
    Log "✅ Dashboard ALREADY RUNNING on http://localhost:3101"
    Start-Process "http://localhost:3101"
    exit 0
} catch { }

# ── 6. Start server ──
Log "🚀 Starting server..."
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$ProjectRoot`" && npx tsx src/apps/certification-dashboard/server.ts" -WindowStyle Hidden -PassThru
Log "📝 Log: $LogFile"

# ── 7. Wait for ready ──
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $c = [System.Net.Sockets.TcpClient]::new()
        $c.Connect("127.0.0.1", 3101)
        $c.Close()
        Log "✅ Dashboard ready at http://localhost:3101 (PID: $($server.Id))"
        Start-Process "http://localhost:3101"
        exit 0
    } catch { }
}

Log "❌ Server failed to start. Check $LogFile"
exit 1
