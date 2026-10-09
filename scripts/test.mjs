// Unit tests: bundles tests/unit/**/*.test.ts with esbuild (our sources use bundler-style
// imports and TS enums, which Node cannot run directly) and runs them with node:test.
//   npm test
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { globSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, '.test-build');
const entries = globSync('tests/unit/**/*.test.ts', { cwd: root });
if (entries.length === 0) {
  console.log('no unit tests found');
  process.exit(0);
}

rmSync(outdir, { recursive: true, force: true });
const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: entries,
  outdir,
  outbase: 'tests/unit',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outExtension: { '.js': '.mjs' },
  sourcemap: 'inline',
  external: ['electron', 'vscode'],
  mainFields: ['module', 'main'],
  // Some dependencies are CommonJS and call require(); give ESM bundles a require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  metafile: true,
  logLevel: 'warning',
});
const outputs = Object.keys(result.metafile.outputs).filter((file) => file.endsWith('.mjs'));
const run = spawnSync(process.execPath, ['--test', '--enable-source-maps', ...outputs], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
