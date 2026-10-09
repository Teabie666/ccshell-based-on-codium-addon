import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SettingsStore } from '../../../src/host/main/settingsStore';
import { writeFileAtomic } from '../../../src/host/node/jsonFile';
import { NullLogger } from '../../../src/platform/log';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccshell-settings-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const temps = (): string[] => fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));

describe('SettingsStore', () => {
  test('sets and removes keys, keeping comments', async () => {
    const file = path.join(dir, 'keep.json');
    fs.writeFileSync(file, '{\n  // mine\n  "a": 1\n}\n');
    const store = new SettingsStore(file, NullLogger);
    await store.set('b', true);
    assert.deepEqual(store.all, { a: 1, b: true });
    await store.set('b', undefined);
    assert.deepEqual(store.all, { a: 1 });
    assert.match(fs.readFileSync(file, 'utf8'), /\/\/ mine/);
  });

  test('a failed write does not fail the ones after it', async () => {
    const file = path.join(dir, 'queue.json');
    // A root that is not an object: the edit cannot be made.
    fs.writeFileSync(file, '[1]');
    const store = new SettingsStore(file, NullLogger);
    await assert.rejects(store.set('a', 1));
    fs.writeFileSync(file, '{}');
    await store.set('b', 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { b: 2 });
  });
});

describe('writeFileAtomic', () => {
  test('retries replacing a file that cannot be replaced for a moment (Windows), and leaves no temp file', async () => {
    const file = path.join(dir, 'busy.json');
    fs.writeFileSync(file, 'old');
    // On Windows a read-only file cannot be replaced (EPERM), like one another process holds.
    fs.chmodSync(file, 0o444);
    setTimeout(() => fs.chmodSync(file, 0o666), 50);
    await writeFileAtomic(file, 'new');
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.deepEqual(temps(), []);
  });
});
