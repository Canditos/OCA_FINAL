Set-Location -LiteralPath "D:\OCA_FINAL_CANDITOS"
$ErrorActionPreference = "Continue"

$logPath = "D:\OCA_FINAL_CANDITOS\.tmp\run_checks_output.txt"

"=== STEP 1: TypeScript Type Check ===" | Out-File -FilePath $logPath -Encoding UTF8
try {
    $tscResult = npx tsc --noEmit 2>&1 | Out-String
    $tscResult | Out-File -FilePath $logPath -Append -Encoding UTF8
    "TSC_EXIT_CODE: $LASTEXITCODE" | Out-File -FilePath $logPath -Append -Encoding UTF8
} catch {
    "TSC_ERROR: $_" | Out-File -FilePath $logPath -Append -Encoding UTF8
}

"`n=== STEP 2: Unit Tests ===" | Out-File -FilePath $logPath -Append -Encoding UTF8
try {
    $testResult = npx vitest run --reporter=verbose 2>&1 | Out-String
    $testResult | Out-File -FilePath $logPath -Append -Encoding UTF8
    "VITEST_EXIT_CODE: $LASTEXITCODE" | Out-File -FilePath $logPath -Append -Encoding UTF8
} catch {
    "VITEST_ERROR: $_" | Out-File -FilePath $logPath -Append -Encoding UTF8
}

Write-Output "Script completed. Output written to $logPath"
