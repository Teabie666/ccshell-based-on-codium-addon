// End-to-end smoke test: drives the real app with Playwright and a real Claude session.
//   npm run smoke            (build first: npm run build)
// Uses a throwaway data dir and workspace under .test-data/, and Haiku to keep usage low.
// Each step prints PASS/FAIL; the process exits non-zero if any step failed.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Anthropic's consumer terms allow automated (scripted) access only through an API key, so
// this test does not drive the signed-in Claude subscription unless told to explicitly.
// API mode (endpoint, key and model from the environment) is planned for M2.
if (!process.argv.includes('--subscription')) {
  console.error('smoke: not running. Scripted use of a Claude subscription is not allowed by the consumer');
  console.error('terms, and the API mode of this test is not wired yet (planned for M2). To run it against');
  console.error('the signed-in account anyway: npm run smoke -- --subscription');
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, '..');
const runDir = path.join(root, '.test-data', `smoke-${Date.now()}`);
const dataDir = path.join(runDir, 'data');
const workspace = path.join(runDir, 'workspace');
const target = path.join(workspace, 'a.txt');
const RESPONSE_TIMEOUT = 120_000;

mkdirSync(dataDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(target, 'alpha\n', 'utf8');
writeFileSync(
  path.join(dataDir, 'settings.json'),
  JSON.stringify(
    {
      // Ask before every edit, so the approval flow is exercised.
      'claudeCode.initialPermissionMode': 'default',
      'claudeCode.hideOnboarding': true,
      'claudeCode.environmentVariables': [{ name: 'ANTHROPIC_MODEL', value: 'claude-haiku-4-5-20251001' }],
    },
    null,
    2,
  ),
  'utf8',
);

const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE' || name.toUpperCase().startsWith('VSCODE_')) delete env[name];
}

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${Date.now() - started} ms)${detail ? ` - ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}: ${error?.message ?? error}`);
  }
}

const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--user-data-dir', dataDir, '--folder', workspace],
  cwd: root,
  env,
  timeout: 60_000,
});
const page = await app.firstWindow();
let frame;

async function waitFor(predicate, timeout, what) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await page.waitForTimeout(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const input = () => frame.locator('[role="textbox"][aria-label="Message input"]');
const conversation = () => frame.locator('[aria-label="Claude Code conversation"]');

async function send(text) {
  await input().click();
  await input().fill(text);
  await frame.locator('button[aria-label="Send message"]').click();
}

async function waitForIdle() {
  // The conversation is idle when the send button is back (no stop button) and input is enabled.
  await waitFor(
    async () => (await frame.locator('button[aria-label="Send message"]').count()) > 0,
    RESPONSE_TIMEOUT,
    'the turn to finish',
  );
}

async function clickPermission(label) {
  // Buttons may carry a keyboard-shortcut digit before the label ("1 Yes").
  const name = new RegExp(`^\\s*(\\d+\\s*)?${label}\\s*$`);
  const button = await waitFor(
    async () => {
      const candidate = frame.getByRole('button', { name });
      return (await candidate.count()) > 0 ? candidate.first() : undefined;
    },
    RESPONSE_TIMEOUT,
    `a permission prompt with "${label}"`,
  );
  await button.click();
}

const readTarget = () => readFileSync(target, 'utf8').trim();

await step('chat webview loads', async () => {
  // The session list is a webview too; the conversation is the iframe of the visible panel.
  const iframe = page.locator('#main .panel:not([hidden]) .webview-frame');
  frame = await waitFor(async () => {
    const candidate = (await iframe.count()) ? await (await iframe.elementHandle())?.contentFrame() : undefined;
    return candidate?.url().startsWith('ccw://wv') ? candidate : undefined;
  }, 30_000, 'the conversation frame');
  await input().waitFor({ timeout: 30_000 });
});

await step('@-mention lists workspace files (workspace.findFiles)', async () => {
  // Runs before any message, so "a.txt" can only appear in the mention suggestions.
  await input().click();
  await input().pressSequentially('@a.t', { delay: 50 });
  await waitFor(async () => (await frame.getByText('a.txt').count()) > 0, 15_000, 'a.txt in the suggestions');
  await input().press('Escape');
  await input().fill('');
});

await step('message round trip', async () => {
  await send('What is 17 + 25? Reply with only the number, nothing else.');
  await waitFor(async () => /\b42\b/.test(await conversation().innerText()), RESPONSE_TIMEOUT, 'the answer 42');
  await waitForIdle();
});

await step('edit approved inline is applied', async () => {
  await send('Use the Edit tool to replace the word alpha with beta in a.txt. Do nothing else.');
  await clickPermission('Yes');
  await waitFor(() => readTarget() === 'beta', RESPONSE_TIMEOUT, 'a.txt to become "beta"');
  await waitForIdle();
  return `a.txt = ${readTarget()}`;
});

await step('edit rejected inline is not applied', async () => {
  await send('Use the Edit tool to replace the word beta with gamma in a.txt. If it is rejected, stop and do nothing else.');
  await clickPermission('No');
  await page.waitForTimeout(3000);
  await waitForIdle();
  if (readTarget() !== 'beta') throw new Error(`a.txt changed to "${readTarget()}"`);
  return 'a.txt still beta';
});

await step('insert_at_mention puts plain text into the input', async () => {
  const text = 'ccshell-insert-check';
  await frame.evaluate((t) => {
    window.postMessage(
      { type: 'from-extension', message: { type: 'request', channelId: '', requestId: '', request: { type: 'insert_at_mention', text: t } } },
      '*',
    );
  }, text);
  await waitFor(async () => (await input().innerText()).includes(text), 10_000, 'the inserted text');
  await input().fill('');
});

await step('io_message shape was logged', async () => {
  const logs = path.join(dataDir, 'logs');
  const session = readdirSync(logs).sort().at(-1);
  const log = readFileSync(path.join(logs, session, 'exthost.log'), 'utf8');
  const line = log.split('\n').find((l) => l.includes('io_message shape:'));
  if (!line) throw new Error('no io_message shape line in exthost.log');
  return line.slice(line.indexOf('io_message shape:'));
});

await page.screenshot({ path: path.join(runDir, 'final.png') });
await app.close();

const unimplemented = path.join(dataDir, 'logs', readdirSync(path.join(dataDir, 'logs')).sort().at(-1), 'shim-unimplemented.log');
if (existsSync(unimplemented)) {
  const lines = readFileSync(unimplemented, 'utf8').trim();
  console.log(`\nunimplemented API used:\n${lines || '(none)'}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed. Artifacts: ${runDir}`);
if (failed === 0 && !process.argv.includes('--keep')) {
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
