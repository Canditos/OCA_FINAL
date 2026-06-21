const { execSync } = require('child_process');
const fs = require('fs');

function run(cmd, outFile) {
    try {
        const output = execSync(cmd, { cwd: 'D:\\OCA_FINAL_CANDITOS', encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
        fs.writeFileSync(outFile, 'SUCCESS\n' + (output || '(no output)'));
    } catch (e) {
        fs.writeFileSync(outFile, 'FAILED\n' + (e.stdout || '') + '\n' + (e.stderr || '') + '\n' + e.message);
    }
}

run('npx tsc --noEmit', '.tmp/tsc_result.txt');
run('npx vitest run --reporter=verbose 2>&1', '.tmp/vitest_result.txt');
