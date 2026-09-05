// Vite builds a single self-contained page from index.dev.html, but names the
// output after the entry file. Rename it to index.html so `dist/` is a folder
// any static host can serve as-is.
//
// Earlier this also copied the page to `index.html` and `JOGAR.html` at the
// repo root. Those were byte-identical twins of dist/index.html — three copies
// of a 260 KB file in every commit — so the build now produces one.
import { existsSync, renameSync, rmSync } from 'node:fs';

const source = 'dist/index.dev.html';
const target = 'dist/index.html';

if (!existsSync(source)) {
  console.error(`postbuild: ${source} not found — did vite build succeed?`);
  process.exit(1);
}

rmSync(target, { force: true });
renameSync(source, target);
console.log(`postbuild: wrote ${target}`);
