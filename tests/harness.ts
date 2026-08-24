/** Minimal assertion harness: no dependencies, runs anywhere Node runs. */

let passed = 0;
let failed = 0;
const failures: string[] = [];
let currentSuite = '';

export function suite(name: string, body: () => void): void {
  currentSuite = name;
  const before = failed;
  try {
    body();
  } catch (err) {
    failed++;
    failures.push(`${name}: threw ${String(err)}`);
  }
  const status = failed === before ? '✓' : '✗';
  console.log(`  ${status} ${name}`);
  currentSuite = '';
}

export function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    return;
  }
  failed++;
  failures.push(`${currentSuite ? currentSuite + ' → ' : ''}${name}${detail ? ` (${detail})` : ''}`);
}

export function equal<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, `expected ${String(expected)}, got ${String(actual)}`);
}

export function report(): number {
  console.log(`\n${passed} assertions passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  return failed === 0 ? 0 : 1;
}
