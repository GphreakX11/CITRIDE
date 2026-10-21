// Usage: node tests/c2-detail-selection.build.mjs /absolute/external/output-directory
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = process.argv[2];
assert.ok(outDir && isAbsolute(outDir), 'Provide an explicit absolute external fixture output directory');
assert.ok(relative(root, resolve(outDir)).startsWith('..'), 'Fixture output must be outside the frontend source tree');
await build({ configFile: false, root, plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { outDir, emptyOutDir: true, lib: {
    entry: fileURLToPath(new URL('./c2-detail-selection.fixture.tsx', import.meta.url)),
    formats: ['es'], fileName: () => 'selection.js', cssFileName: 'selection',
  } },
});
