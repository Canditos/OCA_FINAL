Set-Location -LiteralPath "D:\OCA_FINAL_CANDITOS"
& "C:\Program Files\Git\bin\git.exe" add -A *>$env:TEMP\git_add_out.txt
& "C:\Program Files\Git\bin\git.exe" commit -m "feat: load tests from Xray Test Execution and auto-run workflow" *>>$env:TEMP\git_add_out.txt
& "C:\Program Files\Git\bin\git.exe" log --oneline -3 *>>$env:TEMP\git_add_out.txt
