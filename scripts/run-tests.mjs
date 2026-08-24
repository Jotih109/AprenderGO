// Bundles the TypeScript test suite with esbuild and runs it under Node.
// Keeps the project dependency-free: no test framework, no extra tooling.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'go-master-tests-'));
const outFile = join(outDir, 'tests.mjs');

try {
  await build({
    entryPoints: ['tests/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    outfile: outFile,
    logLevel: 'error'
  });

  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [outFile], { stdio: 'inherit' });
    child.on('close', resolve);
  });

  process.exitCode = code ?? 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
