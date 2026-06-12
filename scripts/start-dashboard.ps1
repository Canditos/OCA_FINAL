# OCPP Certification Dashboard Launcher
$ErrorActionPreference = "SilentlyContinue"
Set-Location $PSScriptRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  OCPP Certification Pipeline Dashboard" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if already running
$conn = New-Object System.Net.Sockets.TcpClient
try {
    $conn.Connect("127.0.0.1", 3101)
    $conn.Close()
    Write-Host "[Launcher] Dashboard already running on http://localhost:3101" -ForegroundColor Green
    Start-Process "http://localhost:3101"
    exit 0
} catch {}

Write-Host "[Launcher] Starting server..." -ForegroundColor Yellow

$server = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c cd /d $PSScriptRoot && npx tsx src/apps/certification-dashboard/server.ts" `
    -WindowStyle Hidden -PassThru

# Wait for server
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", 3101)
        $c.Close()
        $ready = $true
        break
    } catch {}
}

if ($ready) {
    Write-Host "[Launcher] Dashboard ready at http://localhost:3101" -ForegroundColor Green
    Start-Process "http://localhost:3101"
    Write-Host "[Launcher] Server PID: $($server.Id)" -ForegroundColor Gray
    Write-Host "[Launcher] Press Enter to stop..." -ForegroundColor Yellow
    Read-Host
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    Write-Host "[Launcher] Stopped." -ForegroundColor Red
} else {
    Write-Host "[Launcher] Failed to start!" -ForegroundColor Red
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
