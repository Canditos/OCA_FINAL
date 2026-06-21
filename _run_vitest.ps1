npx vitest run --reporter=verbose *>&1 | Out-File -FilePath "$PSScriptRoot\vitest_result.txt" -Encoding UTF8
Write-Host "DONE_VITEST"
