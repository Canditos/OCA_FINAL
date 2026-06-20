@echo off
cd /d D:\OCA_FINAL_CANDITOS

REM Add the new remote
"C:\Program Files\Git\bin\git.exe" remote remove testes 2>nul
"C:\Program Files\Git\bin\git.exe" remote add testes https://github.com/Canditos/TESTES.git

REM Stage all changes
"C:\Program Files\Git\bin\git.exe" add -A

REM Commit
"C:\Program Files\Git\bin\git.exe" commit -m "feat: load tests from Xray Test Execution and auto-run

- Add getXrayTestExecutionTests() and getTestCaseNameFromKey() to JiraClient
- Add GET /api/jira/test-execution-tests endpoint to fetch tests from an execution
- Add 'Load from Execution' UI in Tests sidebar with auto-selection
- Fix individual upload modal field mapping (fwVersion, dut, ocppBackend)
- Add runId to pipeline done broadcast for Jira upload correlation
- Add getAllTestCases() helper function
- Steps automatically mapped to same pass/fail status as the test"

REM Push to testes remote
"C:\Program Files\Git\bin\git.exe" push testes main

pause
