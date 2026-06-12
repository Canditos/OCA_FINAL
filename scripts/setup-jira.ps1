<#
.SYNOPSIS
    Interactive Jira Cloud setup for OCPP Certification Dashboard.
.DESCRIPTION
    Prompts for Jira Cloud credentials, validates them, lists available
    projects, and saves the selection to dashboard-config.json.
.PARAMETER Separate
    Write a standalone jira-config.json instead of merging.
.EXAMPLE
    .\scripts\setup-jira.ps1
.EXAMPLE
    .\scripts\setup-jira.ps1 -Separate
#>
param([switch]$Separate)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConfigFile = Join-Path $ProjectRoot "dashboard-config.json"
$ExampleFile = Join-Path $ProjectRoot "dashboard-config.example.json"

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     Jira Cloud Interactive Setup         ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tip: Get your API token at:" -ForegroundColor Gray
Write-Host "  https://id.atlassian.com/manage-profile/security/api-tokens" -ForegroundColor Gray
Write-Host ""

# ── 1. Gather credentials ──
$baseUrl = Read-Host "Jira Cloud URL [https://your-domain.atlassian.net]"
if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = "https://your-domain.atlassian.net" }
$email = Read-Host "Your Atlassian email"
$apiToken = Read-Host "API Token" -AsSecureString

if ([string]::IsNullOrWhiteSpace($email)) {
    Write-Host "`n❌ Email is required. Aborting." -ForegroundColor Red
    exit 1
}

# Convert SecureString to plain text for API auth
$apiTokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiToken)
)
if ([string]::IsNullOrWhiteSpace($apiTokenPlain)) {
    Write-Host "`n❌ API Token is required. Aborting." -ForegroundColor Red
    exit 1
}

$apiRoot = "$baseUrl/rest/api/3" -replace '/+$',''

# ── 2. Validate connection ──
Write-Host "`n⏳ Connecting to Jira..." -ForegroundColor Cyan
try {
    $encodedCreds = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${email}:${apiTokenPlain}"))
    $me = Invoke-RestMethod -Uri "$apiRoot/myself" -Headers @{ Authorization = "Basic $encodedCreds" } -TimeoutSec 10
    Write-Host "✓ Connected as ""$($me.displayName)"" ($($me.accountType))" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "❌ Authentication failed. Check your email and API token." -ForegroundColor Red
    } else {
        Write-Host "❌ Connection failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    exit 1
}

# ── 3. List projects ──
Write-Host "`n⏳ Fetching projects..." -ForegroundColor Cyan
try {
    $projects = Invoke-RestMethod -Uri "$apiRoot/project" -Headers @{ Authorization = "Basic $encodedCreds" } -TimeoutSec 10
} catch {
    Write-Host "❌ Failed to list projects: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if ($projects.Count -eq 0) {
    Write-Host "❌ No projects found. Check your Jira permissions." -ForegroundColor Red
    exit 1
}

Write-Host "`nFound $($projects.Count) project(s):`n"
$typeIcons = @{ software = "🖥"; service_desk = "🎫"; business = "📋" }
for ($i = 0; $i -lt $projects.Count; $i++) {
    $p = $projects[$i]
    $icon = if ($typeIcons.ContainsKey($p.projectTypeKey)) { $typeIcons[$p.projectTypeKey] } else { "📌" }
    Write-Host ("  {0,2}. {1} {2,-10} {3} ({4})" -f ($i + 1), $icon, $p.key, $p.name, $p.projectTypeKey.Replace('_', ' '))
}

# ── 4. Pick project ──
if ($projects.Count -eq 1) {
    $selected = $projects[0]
    Write-Host "`n→ Auto-selected: $($selected.name) ($($selected.key))" -ForegroundColor Cyan
} else {
    $answer = Read-Host "`nSelect project [1-$($projects.Count)]"
    $idx = [int]$answer
    if ($idx -lt 1 -or $idx -gt $projects.Count) {
        Write-Host "❌ Invalid selection. Aborting." -ForegroundColor Red
        exit 1
    }
    $selected = $projects[$idx - 1]
}

# ── 5. Save configuration ──
$jiraConfig = @{
    jiraBaseUrl    = $baseUrl
    jiraEmail      = $email
    jiraApiToken   = $apiTokenPlain
    jiraProjectKey = $selected.key
}

if ($Separate) {
    $outPath = Join-Path $ProjectRoot "jira-config.json"
    $jiraConfig | ConvertTo-Json -Depth 3 | Set-Content $outPath -Encoding UTF8
    Write-Host "`n✓ Saved to $outPath" -ForegroundColor Green
} else {
    $existing = @{}
    if (Test-Path $ConfigFile) {
        try { $existing = Get-Content $ConfigFile -Raw | ConvertFrom-Json | ConvertTo-CustomObject -AsHashtable } catch {}
    } elseif (Test-Path $ExampleFile) {
        try { $existing = Get-Content $ExampleFile -Raw | ConvertFrom-Json | ConvertTo-CustomObject -AsHashtable } catch {}
    }

    foreach ($key in $jiraConfig.Keys) {
        $existing[$key] = $jiraConfig[$key]
    }

    $existing | ConvertTo-Json -Depth 3 | Set-Content $ConfigFile -Encoding UTF8

    Write-Host "`n✓ Saved to $ConfigFile" -ForegroundColor Green
    Write-Host "  Jira URL  : $baseUrl" -ForegroundColor Gray
    Write-Host "  User      : $($me.displayName)" -ForegroundColor Gray
    Write-Host "  Project   : $($selected.key) — $($selected.name)" -ForegroundColor Gray
}

Write-Host ""
