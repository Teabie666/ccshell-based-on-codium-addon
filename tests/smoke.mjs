// End-to-end smoke test: drives the real app with Playwright and a real Claude session.
//   npm run smoke            (build first: npm run build)
// Uses a throwaway data dir and workspace under .test-data/, and a small model to keep usage low.
// Each step prints PASS/FAIL; the process exits non-zero if any step failed.
//
// It runs against an API, configured by environment variables:
//   CCSHELL_SMOKE_API_KEY     sent as ANTHROPIC_API_KEY (x-api-key), or
//   CCSHELL_SMOKE_AUTH_TOKEN  sent as ANTHROPIC_AUTH_TOKEN (Bearer), e.g. for compatible APIs
//   CCSHELL_SMOKE_BASE_URL    optional, ANTHROPIC_BASE_URL of an Anthropic-compatible API
//   CCSHELL_SMOKE_MODEL       optional, default claude-haiku-4-5-20251001
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Anthropic's consumer terms allow automated (scripted) access only through an API key, so
// this test does not drive the signed-in Claude subscription unless told to explicitly.
const subscription = process.argv.includes('--subscription');
const apiKey = process.env.CCSHELL_SMOKE_API_KEY;
const authToken = process.env.CCSHELL_SMOKE_AUTH_TOKEN;
if (!subscription && !apiKey && !authToken) {
  console.error('smoke: not running. Set CCSHELL_SMOKE_API_KEY or CCSHELL_SMOKE_AUTH_TOKEN (and optionally');
  console.error('CCSHELL_SMOKE_BASE_URL, CCSHELL_SMOKE_MODEL): scripted use of a Claude subscription is not');
  console.error('allowed by the consumer terms. To run it against the signed-in account anyway:');
  console.error('npm run smoke -- --subscription');
  process.exit(2);
}
const model = process.env.CCSHELL_SMOKE_MODEL || 'claude-haiku-4-5-20251001';

/** What the extension passes to the claude process (`claudeCode.environmentVariables`). */
function apiEnvironment() {
  const variables = { ANTHROPIC_MODEL: model };
  if (!subscription) {
    if (process.env.CCSHELL_SMOKE_BASE_URL) variables.ANTHROPIC_BASE_URL = process.env.CCSHELL_SMOKE_BASE_URL;
    if (apiKey) variables.ANTHROPIC_API_KEY = apiKey;
    if (authToken) variables.ANTHROPIC_AUTH_TOKEN = authToken;
    // Background requests (titles...) use the small model; keep every tier on the given one.
    variables.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
    variables.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
    variables.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
    variables.CLAUDE_CODE_SKIP_AUTH_LOGIN = '1';
    variables.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  }
  return Object.entries(variables).map(([name, value]) => ({ name, value }));
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
      'claudeCode.disableLoginPrompt': !subscription,
      // English labels: the steps look for the shell's English buttons.
      'ccshell.language': 'en',
      'claudeCode.environmentVariables': apiEnvironment(),
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
  // On a second monitor, if there is one, out of the way of whoever started the run.
  args: ['.', '--user-data-dir', dataDir, '--folder', workspace, '--secondary-display'],
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

// ---- M2: proposed edits open as diff tabs in the content pane ----------------------------

const diffTab = () => page.locator('#content-pane .content-tab', { hasText: 'a.txt' });
const diffAction = (kind) => page.locator(`#content-pane .content-editor:not([hidden]) .diff-toolbar [data-action="${kind}"]`);

await step('a proposed edit opens a diff tab; Accept there applies it', async () => {
  writeFileSync(target, 'beta\n', 'utf8');
  await send('Use the Edit tool to replace the word beta with delta in a.txt. Do nothing else.');
  await waitFor(async () => (await diffAction('accept').count()) > 0, RESPONSE_TIMEOUT, 'the diff tab with Accept');
  const label = await diffTab().first().innerText();
  await diffAction('accept').click();
  await waitFor(() => readTarget() === 'delta', RESPONSE_TIMEOUT, 'a.txt to become "delta"');
  await waitFor(async () => (await diffTab().count()) === 0, 10_000, 'the diff tab to close');
  await waitForIdle();
  return `${label.trim()}; a.txt = ${readTarget()}`;
});

await step('Reject in the diff tab leaves the file as it was', async () => {
  await send('Use the Edit tool to replace the word delta with omega in a.txt. If it is rejected, stop and do nothing else.');
  await waitFor(async () => (await diffAction('reject').count()) > 0, RESPONSE_TIMEOUT, 'the diff tab with Reject');
  await diffAction('reject').click();
  await waitFor(async () => (await diffTab().count()) === 0, 10_000, 'the diff tab to close');
  await page.waitForTimeout(3000);
  await waitForIdle();
  if (readTarget() !== 'delta') throw new Error(`a.txt changed to "${readTarget()}"`);
  return 'a.txt still delta';
});

await step('a file mention in the chat opens the file in a Monaco tab', async () => {
  await send('Reply with only the word ok. @a.txt');
  // A mention in a sent message is a chip that opens the file (open_file -> showTextDocument).
  const chip = frame.locator('[role="button"][title="Open a.txt"]').first();
  await waitFor(async () => (await chip.count()) > 0, RESPONSE_TIMEOUT, 'the a.txt chip');
  await waitForIdle();
  await chip.click();
  const tab = page.locator('#content-pane .content-tab', { hasText: 'a.txt' });
  await waitFor(async () => (await tab.count()) > 0, 10_000, 'the a.txt tab');
  const text = page.locator('#content-pane .content-editor:not([hidden]) .view-lines');
  await waitFor(async () => (await text.count()) > 0 && (await text.innerText()).includes('delta'), 10_000, 'the file in Monaco');
  await tab.locator('.tab-close').click();
  await waitFor(async () => (await tab.count()) === 0, 5000, 'the tab to close');
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

// Last: Claude may keep planning after the plan is declined.
await step('in plan mode, the plan preview opens as a content pane tab', async () => {
  await input().click();
  // Shift+Tab cycles the permission mode: manual -> edit automatically -> plan.
  await input().press('Shift+Tab');
  await input().press('Shift+Tab');
  await waitFor(async () => (await frame.getByRole('button', { name: /\bPlan\b/ }).count()) > 0, 5000, 'plan mode');
  await send('Make a plan to add a line with the word zeta to a.txt. It is a one-step plan; present it right away without exploring.');
  const preview = page.locator('#content-pane .content-editor:not([hidden]) .webview-frame');
  await waitFor(async () => (await preview.count()) > 0, RESPONSE_TIMEOUT, 'the plan preview in the content pane');
  const label = await page.locator('#content-pane .content-tab.active .tab-label').innerText();
  await clickPermission('No, keep planning');
  return `tab "${label}"`;
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
