@echo off
cd /d "D:\OCA_FINAL_CANDITOS"
echo Starting dashboard... > .tmp\startup.log
npx tsx src/apps/certification-dashboard/server.ts >> .tmp\startup.log 2>&1
