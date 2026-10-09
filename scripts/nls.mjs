// Checks the language packs (src/nls/*.json) against the English strings in the code.
//   npm run nls              list untranslated strings and stale entries (stale ones fail)
//   npm run nls -- --todo    print the untranslated strings as JSON ("key": "English"),
//                            ready to be translated and merged into the pack
//   npm run nls -- --sort    rewrite the packs sorted by key
//   npm run nls -- --todo-extension
//                            print the extension UI texts the table lacks (M3.5) as JSON
//                            ("key": {text, ...}); translate the values to strings and merge
//                            them with tools/extension-strings/merge.mjs
// Every module defines its strings in a file named messages.ts (see src/platform/nls.ts);
// this script bundles all of them to learn the English strings. The extension UI table
// (src/nls/<language>.extension.json) is checked against the local list of the extension's
// texts (tools/extension-strings/extract.mjs) when that list exists.
import * as esbuild from 'esbuild';
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
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
const todoExtension = process.argv.includes('--todo-extension');
const sort = process.argv.includes('--sort');
let failed = false;
// Each --todo prints only its own JSON.
const packs = todoExtension ? [] : globSync('src/nls/*.json', { cwd: root }).filter((name) => !name.endsWith('.extension.json'));
const tables = todo ? [] : globSync('src/nls/*.extension.json', { cwd: root });
for (const file of packs) {
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

for (const file of tables) {
  const language = path.basename(file, '.extension.json');
  const table = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  const listFile = path.join('.local', 'extension-strings', `${table.extensionVersion}.json`);
  if (!existsSync(path.join(root, listFile))) {
    if (todoExtension) {
      console.error(`no ${listFile}: run node tools/extension-strings/extract.mjs`);
      failed = true;
    } else {
      console.log(`nls ${language} (extension UI): not checked, no local text list for ${table.extensionVersion}`);
    }
    continue;
  }
  const list = JSON.parse(readFileSync(path.join(root, listFile), 'utf8'));
  const missing = {};
  for (const section of ['strings', 'templates']) {
    for (const [key, entry] of Object.entries(list[section])) {
      if (!(key in table[section])) {
        missing[key] = { text: entry.text, kinds: entry.kinds, ...(entry.sentences ? { sentences: entry.sentences } : {}) };
      }
    }
  }
  if (todoExtension) {
    console.log(JSON.stringify(missing, null, 2));
    continue;
  }
  const stale = ['strings', 'templates'].flatMap((section) =>
    Object.keys(table[section])
      .filter((key) => !(key in list[section]))
      .map((key) => `${key} (${JSON.stringify(section === 'strings' ? table.strings[key] : table.templates[key].text)})`),
  );
  const total = Object.keys(list.strings).length + Object.keys(list.templates).length;
  console.log(
    `nls ${language} (extension UI ${table.extensionVersion}): ${Object.keys(missing).length} of ${total} untranslated ` +
      `(npm run nls -- --todo-extension), ${stale.length} stale`,
  );
  for (const entry of stale) {
    console.log(`  stale         ${entry} (the extension no longer has it; tools/extension-strings/merge.mjs drops it)`);
  }
  failed ||= stale.length > 0;
}
process.exit(failed ? 1 : 0);
