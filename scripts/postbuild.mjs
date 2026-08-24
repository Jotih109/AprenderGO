// Vite builds a single self-contained page from index.dev.html. This copies the
// result to the filenames the project ships with, cross-platform (the previous
// version shelled out to PowerShell and only worked on Windows).
import { copyFileSync, existsSync, rmSync } from 'node:fs';

const source = 'dist/index.dev.html';

if (!existsSync(source)) {
  console.error(`postbuild: ${source} not found — did vite build succeed?`);
  process.exit(1);
}

const targets = ['index.html', 'JOGAR.html', 'dist/index.html'];

for (const target of targets) {
  copyFileSync(source, target);
  console.log(`postbuild: wrote ${target}`);
}

// Vite names its output after the entry file, which leaves dist/index.dev.html
// as a byte-identical twin of dist/index.html. Drop it so dist holds one page.
rmSync(source, { force: true });
