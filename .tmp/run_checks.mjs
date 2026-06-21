import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const logPath = join(import.meta.dirname, 'run_checks_output.txt');
let log = '';

function append(msg) {
  log += msg + '\n';
  process.stdout.write(msg + '\n');
}

try {
  append('=== STEP 1: TypeScript Type Check ===');
  try {
    const tsc = execSync('npx tsc --noEmit', { 
      cwd: 'D:\\OCA_FINAL_CANDITOS',
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000
    });
    append(tsc);
    append('TSC_EXIT_CODE: 0');
  } catch (e) {
    append(e.stdout || '');
    append(e.stderr || '');
    append('TSC_EXIT_CODE: ' + (e.status || 1));
  }

  append('\n=== STEP 2: Unit Tests ===');
  try {
    const test = execSync('npx vitest run --reporter=verbose', {
      cwd: 'D:\\OCA_FINAL_CANDITOS',
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 300000
    });
    append(test);
    append('VITEST_EXIT_CODE: 0');
  } catch (e) {
    append(e.stdout || '');
    append(e.stderr || '');
    append('VITEST_EXIT_CODE: ' + (e.status || 1));
  }
} catch (e) {
  append('FATAL ERROR: ' + e.message);
}

writeFileSync(logPath, log, 'utf8');
console.log('Output written to ' + logPath);
