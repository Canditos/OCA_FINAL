npx tsc --noEmit *>&1 | Out-File -FilePath "$PSScriptRoot\tsc_result.txt" -Encoding UTF8
Write-Host "DONE_TSC"
