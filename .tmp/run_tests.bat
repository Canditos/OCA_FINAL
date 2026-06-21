@echo off
cd /d D:\OCA_FINAL_CANDITOS
call npx tsc --noEmit > .tmp\tsc_result.txt 2>&1
call npx vitest run --reporter=verbose >> .tmp\tsc_result.txt 2>&1
echo DONE >> .tmp\tsc_result.txt
