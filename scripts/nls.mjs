// Checks the language packs (src/nls/*.json) against the English strings in the code.
//   npm run nls              list untranslated strings and stale entries (stale ones fail)
//   npm run nls -- --todo    print the untranslated strings as JSON ("key": "English"),
//                            ready to be translated and merged into the pack
//   npm run nls -- --sort    rewrite the packs sorted by key
// Every module defines its strings in a file named messages.ts (see src/platform/nls.ts);
// this script bundles all of them to learn the English strings.
import * as esbuild from 'esbuild';
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const modules = globSync('src/**/messages.ts', { cwd: root }).map((file) => file.replaceAll('\\', '/'));
const entry = [...modules.map((file) => `import './${file}';`), "export { checkPack } from './src/platform/nls';"].join('\n');
const bundle = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts', sourcefile: 'nls-check.ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'warning',
});
const { checkPack } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const todo = process.argv.includes('--todo');
const sort = process.argv.includes('--sort');
let failed = false;
for (const file of globSync('src/nls/*.json', { cwd: root })) {
  const fullPath = path.join(root, file);
  const pack = JSON.parse(readFileSync(fullPath, 'utf8'));
  const language = path.basename(file, '.json');
  if (sort) {
    const sorted = Object.fromEntries(Object.entries(pack).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    writeFileSync(fullPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  }
  const { missing, stale } = checkPack(pack);
  if (todo) {
    console.log(JSON.stringify(missing, null, 2));
    continue;
  }
  const untranslated = Object.entries(missing);
  console.log(`nls ${language}: ${untranslated.length} untranslated, ${stale.length} stale (${modules.length} modules)`);
  for (const [key, english] of untranslated) {
    console.log(`  untranslated  ${key}: ${english}`);
  }
  for (const key of stale) {
    console.log(`  stale         ${key} (no string uses it; remove it from ${file})`);
  }
  failed ||= stale.length > 0;
}
process.exit(failed ? 1 : 0);
