cd D:\OCA_FINAL_CANDITOS
git add src/apps/certification-dashboard/public/index.html src/apps/certification-dashboard/public/app.js
$OUT = git status --short 2>&1
$OUT | Out-File "D:\OCA_FINAL_CANDITOS\.tmp_output.txt"
git commit -m "feat: add Jira upload success modal with OK button to close upload window" 2>&1 | Out-File "D:\OCA_FINAL_CANDITOS\.tmp_output.txt" -Append
git log --oneline -3 2>&1 | Out-File "D:\OCA_FINAL_CANDITOS\.tmp_output.txt" -Append
