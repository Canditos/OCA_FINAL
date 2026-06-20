@echo off
cd /d D:\OCA_FINAL_CANDITOS
"C:\Program Files\Git\bin\git.exe" remote add testes https://github.com/Canditos/TESTES.git 2>&1
"C:\Program Files\Git\bin\git.exe" remote set-url testes https://github.com/Canditos/TESTES.git 2>&1
"C:\Program Files\Git\bin\git.exe" add -A
"C:\Program Files\Git\bin\git.exe" commit -m "feat: load tests from Xray Test Execution and auto-run"
"C:\Program Files\Git\bin\git.exe" push testes main
pause
