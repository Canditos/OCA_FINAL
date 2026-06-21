const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = __dirname;
function run(cmd, outFile) {
  try {
    const out = execSync(cmd, { cwd: __dirname, encoding: 'utf8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
    fs.writeFileSync(path.join(outDir, outFile), out || '(no output)', 'utf8');
  } catch(e) {
    fs.writeFileSync(path.join(outDir, outFile), 
      'STDOUT:\n' + (e.stdout || '') + '\n\nSTDERR:\n' + (e.stderr || '') + '\n\nERROR:\n' + e.message, 'utf8');
  }
}
run('npx tsc --noEmit', 'tsc_result.txt');
run('npx vitest run --reporter=verbose', 'vitest_result.txt');
console.log('DONE');
