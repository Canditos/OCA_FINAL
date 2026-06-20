& "C:\Program Files\Git\bin\git.exe" add -A
& "C:\Program Files\Git\bin\git.exe" commit -m "feat: load tests from Xray Test Execution and auto-run

- Add getXrayTestExecutionTests() and getTestCaseNameFromKey() to JiraClient
- Add GET /api/jira/test-execution-tests endpoint to fetch tests from an execution
- Add 'Load from Execution' UI in Tests sidebar with auto-selection
- Fix individual upload modal field mapping (fwVersion, dut, ocppBackend)
- Add runId to pipeline done broadcast for Jira upload correlation
- Add getAllTestCases() helper function
- Steps automatically mapped to same pass/fail status as the test"