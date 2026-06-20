$log = "D:\OCA_FINAL_CANDITOS\.tmp\git_result.txt"
$git = "C:\Program Files\Git\bin\git.exe"
$dir = "D:\OCA_FINAL_CANDITOS"

Set-Location $dir
& $git add -A | Out-File $log -Encoding utf8
& $git commit -m "feat: load tests from Xray Test Execution and auto-run workflow" 2>&1 | Out-File $log -Append -Encoding utf8
& $git log --oneline -3 2>&1 | Out-File $log -Append -Encoding utf8
Get-Content $log
