# ════════════════════════════════════════════════════════════
# Setup Config — Configures the dashboard for first use
# ════════════════════════════════════════════════════════════
#
# Usage on new machine after clone:
#   powershell -File scripts/setup-config.ps1
#
# Options:
#   -FromEnv      Read config from env vars (CI/CD friendly)
#   -EncryptionKey <key>  Set a custom encryption key (portable across machines)
# ════════════════════════════════════════════════════════════

param(
    [switch]$FromEnv,
    [string]$EncryptionKey
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ExamplePath = Join-Path $ProjectRoot "dashboard-config.example.json"
$ConfigPath = Join-Path $ProjectRoot "dashboard-config.json"

# ── Check ──
if (Test-Path $ConfigPath) {
    $yn = Read-Host "dashboard-config.json already exists. Overwrite? (y/N)"
    if ($yn -ne "y") { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
}

# ── Read example ──
if (!(Test-Path $ExamplePath)) {
    Write-Host "ERROR: dashboard-config.example.json not found!" -ForegroundColor Red
    exit 1
}

$cfg = Get-Content $ExamplePath -Raw | ConvertFrom-Json

if ($FromEnv) {
    # Read from environment variables
    Write-Host "Reading config from environment variables..." -ForegroundColor Cyan
    $cfg.octtBaseUrl = [Environment]::GetEnvironmentVariable("OCTT_BASE_URL") ?? $cfg.octtBaseUrl
    $cfg.octtToken = [Environment]::GetEnvironmentVariable("OCTT_TOKEN") ?? $cfg.octtToken
    $cfg.cdsIp = [Environment]::GetEnvironmentVariable("CDS_IP") ?? $cfg.cdsIp
    $cfg.cdsPort = [Environment]::GetEnvironmentVariable("CDS_PORT") ?? $cfg.cdsPort
    $cfg.jiraBaseUrl = [Environment]::GetEnvironmentVariable("JIRA_BASE_URL") ?? $cfg.jiraBaseUrl
    $cfg.jiraEmail = [Environment]::GetEnvironmentVariable("JIRA_EMAIL") ?? $cfg.jiraEmail
    $cfg.jiraApiToken = [Environment]::GetEnvironmentVariable("JIRA_API_TOKEN") ?? $cfg.jiraApiToken
    $cfg.jiraProjectKey = [Environment]::GetEnvironmentVariable("JIRA_PROJECT_KEY") ?? $cfg.jiraProjectKey
} else {
    # Interactive prompts
    Write-Host "`n=== Dashboard Configuration ===`n" -ForegroundColor Cyan
    Write-Host "Press Enter to keep default value in brackets.`n" -ForegroundColor Gray

    $cfg.octtBaseUrl = Read-Host "OCTT Base URL [$($cfg.octtBaseUrl)]"
    if (!$cfg.octtBaseUrl) { $cfg.octtBaseUrl = (Get-Content $ExamplePath -Raw | ConvertFrom-Json).octtBaseUrl }

    $cfg.octtToken = Read-Host "OCTT API Token [****]"
    $cfg.octtOcppVersion = Read-Host "OCPP Version (ocpp1.6 / ocpp2.0.1) [$($cfg.octtOcppVersion)]"

    $cfg.cdsIp = Read-Host "CDS IP Address [$($cfg.cdsIp)]"
    $cfg.cdsPort = Read-Host "CDS Port [$($cfg.cdsPort)]"

    $cfg.jiraBaseUrl = Read-Host "Jira Base URL [$($cfg.jiraBaseUrl)]"
    $cfg.jiraEmail = Read-Host "Jira Email [$($cfg.jiraEmail)]"
    $cfg.jiraApiToken = Read-Host "Jira API Token [****]"
    $cfg.jiraProjectKey = Read-Host "Jira Project Key [$($cfg.jiraProjectKey)]"
}

# ── Save ──
$cfg | ConvertTo-Json | Set-Content $ConfigPath -Encoding UTF8
Write-Host "`n✅ Config saved to: $ConfigPath" -ForegroundColor Green

# ── Encryption key hint ──
if ($EncryptionKey) {
    $envContent = @"
# Dashboard Encryption Key (same on all machines = portable config)
ENCRYPTION_KEY=$EncryptionKey
"@
    $envPath = Join-Path $ProjectRoot ".env"
    Set-Content -Path $envPath -Value $envContent
    Write-Host "✅ .env file created with ENCRYPTION_KEY" -ForegroundColor Green
    Write-Host "   Use this same key on all machines to share encrypted config.`n" -ForegroundColor Gray
} else {
    Write-Host "`nTIP: To share this config across machines, run:" -ForegroundColor Yellow
    Write-Host "  powershell -File scripts/setup-config.ps1 -EncryptionKey (your-secret-key)" -ForegroundColor Gray
    Write-Host "  Then set the same ENCRYPTION_KEY env var on every machine.`n" -ForegroundColor Gray
}

Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. npm install"
Write-Host "  2. npm run dev:cert"
Write-Host "  3. Open http://localhost:3101`n" -ForegroundColor White
