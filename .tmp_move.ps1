$files = @(
    "clear-error.ts", "cds-old.ts", "jira_issue_fields.ts", "jira_issue_fields2.ts", "jira_issue_fields3.ts",
    "jira_step_schema.ts", "jira_test_schema.ts", "jira_test.ts", "jira_test2.ts", "jira_test3.ts",
    "jira_xray_schema.ts", "jira_xray_schema2.ts", "jira_xray_test.ts", "jira_xray_test4.ts",
    "jira_xray_test5.ts", "jira_xray_test6.ts", "jira_xray_test7.ts", "jira_xray_test8.ts",
    "check.js", "debug-cds.js", "test-reset.js",
    "dump.html", "findings.md", "gemini.md", "progress.md", "task_plan.md",
    "sut-keypad.html", "test_echo.txt", "screenshot.cjs"
)

$moved = @()
$notFound = @()
$root = "D:\OCA_FINAL_CANDITOS"
$dest = "D:\OCA_FINAL_CANDITOS\scratch"

foreach ($f in $files) {
    $src = Join-Path $root $f
    if (Test-Path -LiteralPath $src) {
        Move-Item -LiteralPath $src -Destination $dest -Force
        $moved += $f
    } else {
        $notFound += $f
    }
}

@{
    moved = $moved
    notFound = $notFound
} | ConvertTo-Json | Out-File -FilePath "D:\OCA_FINAL_CANDITOS\.tmp_result.json" -Encoding UTF8
