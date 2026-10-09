// Shell UI test: keybindings, sidebar, conversation tabs, command palette, themes, find, zoom,
// context menus, restart restore.
// Sends no messages to Claude (no usage).   npm run build && node tests/ui.mjs
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const runDir = path.join(root, '.test-data', `ui-${Date.now()}`);
const dataDir = path.join(runDir, 'data');
const workspace = path.join(runDir, 'workspace');
mkdirSync(dataDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
// English, whatever the system language: the steps look for English labels. The last
// step switches to Chinese.
const settingsFile = path.join(dataDir, 'settings.json');
writeFileSync(settingsFile, JSON.stringify({ 'claudeCode.hideOnboarding': true, 'ccshell.language': 'en' }), 'utf8');

const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE' || name.toUpperCase().startsWith('VSCODE_')) delete env[name];
}

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push(true);
    console.log(`PASS  ${name} (${Date.now() - started} ms)${detail ? ` - ${detail}` : ''}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}: ${error?.message ?? error}`);
  }
}

const launch = () =>
  electron.launch({
    executablePath: electronPath,
    args: ['.', '--user-data-dir', dataDir, '--folder', workspace],
    cwd: root,
    env,
    timeout: 60_000,
  });
let app = await launch();
let page = await app.firstWindow();

async function waitFor(predicate, timeout, what) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await page.waitForTimeout(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const tabCount = () => page.locator('#tabs .tab').count();
const webviewFrames = () => page.frames().filter((f) => f.url().startsWith('ccw://wv'));

/**
 * Presses a shortcut through Electron's input pipeline (webContents.sendInputEvent), the
 * same path real keyboard input takes. Playwright's keyboard goes through the DevTools
 * protocol, which bypasses main's before-input-event and so our intercepted shortcuts.
 */
async function press(shortcut, target = 'main') {
  const parts = shortcut.split('+');
  const keyCode = parts.pop();
  const modifiers = parts.map((m) => m.toLowerCase());
  await app.evaluate(({ BrowserWindow }, { keyCode, modifiers, target }) => {
    // The main window shows ccw://app; a tab's own window is a blank page it fills.
    const window = BrowserWindow.getAllWindows().find((w) =>
      target === 'main' ? w.webContents.getURL().startsWith('ccw://app/') : w.webContents.getURL() === 'about:blank',
    );
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { keyCode, modifiers, target });
}

await step('chat panel and session list load', async () => {
  await waitFor(async () => (await tabCount()) === 1, 30_000, 'the first conversation tab');
  await waitFor(() => webviewFrames().length >= 2, 30_000, 'two webviews (chat + session list)');
  return `${webviewFrames().length} webviews`;
});

await step('Ctrl+B toggles the session list', async () => {
  await press('Control+B');
  await waitFor(() => page.locator('#sidebar').isHidden(), 5000, 'the sidebar to hide');
  await press('Control+B');
  await waitFor(() => page.locator('#sidebar').isVisible(), 5000, 'the sidebar to show');
});

await step('Ctrl+N opens a conversation, Ctrl+Tab cycles, Ctrl+W closes', async () => {
  await press('Control+N');
  await waitFor(async () => (await tabCount()) === 2, 20_000, 'a second tab');
  const activeBefore = await page.locator('#tabs .tab.active').getAttribute('data-panel-id');
  await press('Control+Tab');
  await waitFor(
    async () => (await page.locator('#tabs .tab.active').getAttribute('data-panel-id')) !== activeBefore,
    5000,
    'Ctrl+Tab to switch tabs',
  );
  await press('Control+W');
  await waitFor(async () => (await tabCount()) === 1, 10_000, 'the tab to close');
});

await step('command palette switches the color theme for shell and webviews', async () => {
  await press('Control+Shift+P');
  const filter = page.locator('.quick-input-filter');
  await filter.waitFor({ timeout: 5000 });
  await filter.fill('Color Theme');
  await filter.press('Enter');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) > 1, 5000, 'the theme list');
  await page.locator('.quick-input-filter').fill('Light Modern');
  await page.locator('.quick-input-filter').press('Enter');
  await waitFor(() => page.evaluate(() => document.body.classList.contains('vscode-light')), 5000, 'the shell to turn light');
  const chat = webviewFrames()[0];
  await waitFor(() => chat.evaluate(() => document.body.classList.contains('vscode-light')), 5000, 'the webview to turn light');
  // Back to the default.
  await press('Control+Shift+P');
  await page.locator('.quick-input-filter').fill('Color Theme');
  await page.locator('.quick-input-filter').press('Enter');
  await page.locator('.quick-input-filter').fill('Dark Modern');
  await page.locator('.quick-input-filter').press('Enter');
  await waitFor(() => page.evaluate(() => document.body.classList.contains('vscode-dark')), 5000, 'the shell to turn dark');
});

await step('Ctrl+F finds text in the active conversation', async () => {
  // A just-opened conversation renders its welcome content a moment later.
  await waitFor(async () => {
    for (const frame of webviewFrames()) {
      if (await frame.evaluate(() => document.body.innerText.includes('Claude'))) return true;
    }
    return false;
  }, 10_000, 'conversation content');
  await press('Control+F');
  const input = page.locator('.find-input');
  await input.waitFor({ timeout: 5000 });
  await input.fill('Claude');
  const count = await waitFor(async () => {
    const text = await page.locator('.find-count').innerText();
    return /^\d+ of \d+$/.test(text) ? text : undefined;
  }, 5000, 'a match count');
  await input.press('Enter');
  await waitFor(async () => (await page.locator('.find-count').innerText()).startsWith('2 of'), 3000, 'Enter to move to match 2');
  await input.press('Escape');
  await waitFor(() => page.locator('.find-widget').isHidden(), 3000, 'the find widget to close');
  return count;
});
await step('Ctrl+= zooms in and Ctrl+0 resets', async () => {
  const before = await page.evaluate(() => window.devicePixelRatio);
  await press('Control+=');
  await waitFor(async () => (await page.evaluate(() => window.devicePixelRatio)) > before, 3000, 'zoom in');
  await press('Control+0');
  await waitFor(async () => (await page.evaluate(() => window.devicePixelRatio)) === before, 3000, 'zoom reset');
});

/**
 * Right-clicks with Playwright's mouse. Unlike keys (see press()), mouse input must not go
 * through webContents.sendInputEvent: that injects into the top frame and skips Chromium's
 * routing into out-of-process iframes, so the menu would belong to the shell page instead
 * of the webview. DevTools-protocol input is routed like real input.
 */
async function rightClick(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('nothing to right-click');
  await page.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 3), { button: 'right' });
}

/** Runs `fn` while native menus are recorded instead of shown (a shown menu blocks the test). */
async function withRecordedMenus(fn) {
  await app.evaluate(({ Menu }) => {
    globalThis.ccshellRealPopup = Menu.prototype.popup;
    Menu.prototype.popup = function () {
      globalThis.ccshellLastMenu = this;
    };
  });
  try {
    return await fn();
  } finally {
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = globalThis.ccshellRealPopup;
      delete globalThis.ccshellLastMenu;
    });
  }
}
const recordedMenu = () =>
  app.evaluate(() => globalThis.ccshellLastMenu?.items.map((item) => (item.type === 'separator' ? '---' : item.label)));
const clickRecordedMenuItem = (label) =>
  app.evaluate((_electron, label) => {
    globalThis.ccshellLastMenu.items.find((item) => item.label === label).click();
  }, label);
const activeConversation = () => page.locator('#main .panel:not([hidden]) .webview-frame');
/** The extension's webview/context items, as an English UI shows them (sorted by title). */
const conversationMenu = ['Add Session Tab to Group', 'Mark Session as Unread', 'Rename Session Tab'];

await step('right-click in a conversation offers the extension menu; Rename Session Tab runs', () => withRecordedMenus(async () => {
  await rightClick(activeConversation());
  const labels = await waitFor(recordedMenu, 5000, 'the context menu');
  if (labels.filter((label) => conversationMenu.includes(label)).join('|') !== conversationMenu.join('|')) {
    throw new Error(`menu was: ${labels.join(' | ')}`);
  }

  await clickRecordedMenuItem('Rename Session Tab');
  const outcome = await waitFor(async () => {
    if (await page.locator('.quick-input-filter').count()) return 'input box';
    const toast = page.locator('.toast-message');
    return (await toast.count()) ? `message "${await toast.first().innerText()}"` : undefined;
  }, 10_000, 'the rename command to answer');
  if (outcome === 'input box') {
    // The extension's validateInput refuses an empty name; the shell asks again with its message.
    await page.locator('.quick-input-filter').fill('');
    await page.locator('.quick-input-filter').press('Enter');
    const message = await waitFor(async () => {
      const validation = page.locator('.quick-input-validation');
      return (await validation.count()) ? validation.innerText() : undefined;
    }, 5000, 'the validation message');
    await page.locator('.quick-input-filter').press('Escape');
    await waitFor(async () => (await page.locator('.quick-input-filter').count()) === 0, 3000, 'the input box to close');
    return `${labels.length} menu entries; rename asked for a name, empty refused ("${message}"), cancelled`;
  }
  await page.locator('.toast-close').first().click();
  return `${labels.length} menu entries; rename answered with ${outcome}`;
}));

await step('Add Session Tab to Group from the conversation menu shows the group picker', () => withRecordedMenus(async () => {
  await rightClick(activeConversation());
  await waitFor(recordedMenu, 5000, 'the context menu');
  await clickRecordedMenuItem('Add Session Tab to Group');
  const items = await waitFor(async () => {
    const rows = page.locator('.quick-input-item');
    return (await rows.count()) ? rows.allInnerTexts() : undefined;
  }, 10_000, 'the group picker');
  await page.locator('.quick-input-filter').press('Escape');
  await waitFor(async () => (await page.locator('.quick-input-filter').count()) === 0, 3000, 'the picker to close');
  if (!items.some((item) => item.startsWith('New group'))) throw new Error(`picker had: ${items.join(' | ')}`);
  return `picker: ${items.join(' | ')}`;
}));

await step('right-click in the session list does not offer the conversation menu', () => withRecordedMenus(async () => {
  await rightClick(page.locator('#sidebar .webview-frame'));
  await page.waitForTimeout(1000);
  const labels = (await recordedMenu()) ?? [];
  if (labels.some((label) => conversationMenu.includes(label))) throw new Error(`menu was: ${labels.join(' | ')}`);
  return labels.length ? `menu: ${labels.join(' | ')}` : 'no menu';
}));

// ---- content pane and editor ------------------------------------------------------------

const sampleFile = path.join(workspace, 'src', 'sample.ts');
const sampleText = 'export const answer: number = 42;\n// a comment\nfunction greet(name: string) {\n  return `hi ${name}`;\n}\n';
mkdirSync(path.dirname(sampleFile), { recursive: true });
writeFileSync(sampleFile, sampleText, 'utf8');
const contentTabs = () => page.locator('#content-pane .content-tab');
// Monaco renders spaces as no-break spaces.
const editorText = async () =>
  (await page.locator('#content-pane .content-editor:not([hidden]) .view-lines').innerText()).replace(/ /g, ' ');

await step('Ctrl+P opens a file in the content pane, highlighted', async () => {
  await press('Control+P');
  const filter = page.locator('.quick-input-filter');
  await filter.waitFor({ timeout: 5000 });
  await filter.fill('sampl');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) > 0, 10_000, 'the file in the list');
  await filter.press('Enter');
  await waitFor(async () => (await contentTabs().count()) === 1, 15_000, 'a content tab');
  await waitFor(async () => (await editorText()).includes('answer'), 15_000, 'the file text in Monaco');
  // Tokens get colors once the grammar has loaded.
  const colors = await waitFor(async () => {
    const found = await page.evaluate(() => {
      const spans = document.querySelectorAll('#content-pane .view-line span span');
      return [...new Set([...spans].map((span) => getComputedStyle(span).color))];
    });
    return found.length >= 3 ? found : undefined;
  }, 15_000, 'syntax colors');
  await page.screenshot({ path: path.join(runDir, 'editor.png') });
  return `${colors.length} token colors`;
});

await step('the conversation sees the open file (selection sync)', async () => {
  const seen = await waitFor(async () => {
    for (const frame of webviewFrames()) {
      if (await frame.evaluate(() => document.body.innerText.includes('sample.ts')).catch(() => false)) return true;
    }
    return false;
  }, 10_000, 'sample.ts in the chat');
  return seen ? 'chat mentions sample.ts' : '';
});

await step('typing marks the tab dirty; Ctrl+S saves to disk', async () => {
  await page.locator('#content-pane .monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// edited');
  await waitFor(async () => (await page.locator('#content-pane .content-tab.dirty').count()) === 1, 5000, 'the dirty marker');
  await press('Control+S');
  await waitFor(() => readFileSync(sampleFile, 'utf8').includes('// edited'), 5000, 'the file on disk');
  await waitFor(async () => (await page.locator('#content-pane .content-tab.dirty').count()) === 0, 5000, 'the tab to be clean');
});

await step('a change on disk reloads the clean editor', async () => {
  writeFileSync(sampleFile, `${readFileSync(sampleFile, 'utf8')}\n// from outside\n`, 'utf8');
  await waitFor(async () => (await editorText()).includes('from outside'), 10_000, 'the editor to reload');
});

await step('Ctrl+/ toggles a line comment (the language configuration)', async () => {
  await page.locator('#content-pane .monaco-editor .view-lines').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+/');
  await waitFor(async () => (await editorText()).includes('// export const answer'), 5000, 'the commented line');
  await page.keyboard.press('Control+Z');
  await waitFor(async () => !(await editorText()).includes('// export const answer'), 5000, 'the undo');
  await waitFor(async () => (await page.locator('#content-pane .content-tab.dirty').count()) === 0, 5000, 'the tab clean again');
});

await step('Compare Active File with Saved opens a diff tab (vscode.diff)', async () => {
  await page.locator('#content-pane .monaco-editor .view-lines').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('// unsaved\n');
  await press('Control+Shift+P');
  await page.locator('.quick-input-filter').fill('Compare Active File with Saved');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) === 1, 5000, 'the command');
  await page.locator('.quick-input-filter').press('Enter');
  await waitFor(async () => (await contentTabs().count()) === 2, 10_000, 'a diff tab');
  await page.locator('#content-pane .monaco-diff-editor').waitFor({ timeout: 10_000 });
  // The diff is computed in Monaco's worker: inserted lines get marked once it answers.
  await waitFor(
    async () => (await page.locator('#content-pane .monaco-diff-editor :is(.line-insert, .char-insert)').count()) > 0,
    10_000,
    'the inserted line to be marked',
  );
  const label = await page.locator('#content-pane .content-tab.active .tab-label').innerText();
  await press('Control+W');
  await waitFor(async () => (await contentTabs().count()) === 1, 5000, 'the diff tab to close');
  // Back on the file: save, so later steps start clean.
  await page.locator('#content-pane .monaco-editor .view-lines').click();
  await press('Control+S');
  await waitFor(async () => (await page.locator('#content-pane .content-tab.dirty').count()) === 0, 5000, 'the file to be saved');
  return label;
});

await step('a Markdown file opens as a preview, with highlighted code and a local image, and toggles to source', async () => {
  // A 1x1 PNG next to the document.
  mkdirSync(path.join(workspace, 'img'), { recursive: true });
  writeFileSync(
    path.join(workspace, 'img', 'dot.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  );
  writeFileSync(
    path.join(workspace, 'notes.md'),
    '# Plan notes\n\nSee [the sample](src/sample.ts).\n\n![dot](img/dot.png)\n\n```ts\nconst x: number = 1;\n```\n',
    'utf8',
  );
  await press('Control+P');
  await page.locator('.quick-input-filter').fill('notes.md');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) > 0, 10_000, 'notes.md in the list');
  await page.locator('.quick-input-filter').press('Enter');
  const heading = page.locator('#content-pane .markdown-preview:not([hidden]) h1');
  await waitFor(async () => (await heading.count()) === 1 && (await heading.innerText()) === 'Plan notes', 10_000, 'the rendered heading');
  await waitFor(async () => (await page.locator('#content-pane .markdown-preview pre.shiki').count()) === 1, 10_000, 'a highlighted code block');
  await waitFor(
    () => page.locator('#content-pane .markdown-preview img').evaluate((img) => img.complete && img.naturalWidth > 0),
    5000,
    'the workspace image to load',
  );
  await page.locator('#content-pane .editor-toolbar .button', { hasText: 'Open Source' }).click();
  await waitFor(async () => (await editorText()).includes('# Plan notes'), 5000, 'the source view');
  await page.locator('#content-pane .editor-toolbar .button', { hasText: 'Open Preview' }).click();
  await waitFor(() => heading.isVisible(), 5000, 'the preview again');
  await page.locator('#content-pane .markdown-preview').click();
  await press('Control+W');
  await waitFor(async () => (await contentTabs().count()) === 1, 5000, 'the Markdown tab to close');
});

await step('Ctrl+W in the editor closes its tab and the pane hides; the conversation stays', async () => {
  const conversations = await tabCount();
  await page.locator('#content-pane .monaco-editor .view-lines').click();
  await press('Control+W');
  await waitFor(async () => (await contentTabs().count()) === 0, 5000, 'the content tab to close');
  await waitFor(() => page.locator('#content-pane').isHidden(), 5000, 'the pane to hide');
  if ((await tabCount()) !== conversations) throw new Error('a conversation closed too');
});

await step('Claude: Show Logs opens the extension log in the content pane', async () => {
  await press('Control+Shift+P');
  await page.locator('.quick-input-filter').fill('Claude: Show Logs');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) === 1, 5000, 'the command');
  await page.locator('.quick-input-filter').press('Enter');
  await waitFor(async () => (await contentTabs().count()) === 1, 10_000, 'the log tab');
  const label = await page.locator('#content-pane .content-tab.active .tab-label').innerText();
  if (!label.endsWith('.log')) throw new Error(`tab is ${label}`);
  await page.locator('#content-pane .monaco-editor .view-lines').click();
  await press('Control+W');
  await waitFor(async () => (await contentTabs().count()) === 0, 5000, 'the log tab to close');
  return label;
});

await step('a tab moves into its own window, edits and saves there, and moves back', async () => {
  await press('Control+P');
  await page.locator('.quick-input-filter').fill('sample.ts');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) > 0, 10_000, 'sample.ts in the list');
  await page.locator('.quick-input-filter').press('Enter');
  await waitFor(async () => (await editorText()).includes('answer'), 10_000, 'sample.ts in the pane');

  const opened = app.waitForEvent('window');
  await page.locator('#content-pane .icon-pop-out').click();
  const aux = await opened;
  const auxText = async () => (await aux.locator('.aux-body .view-lines').innerText()).replace(/ /g, ' ');
  await waitFor(async () => (await aux.locator('.aux-body .view-lines').count()) > 0 && (await auxText()).includes('answer'), 10_000, 'the editor in the new window');
  // Monaco's generated styles (token colors) must reach the new window.
  const colors = await waitFor(async () => {
    const count = await aux.evaluate(() => new Set([...document.querySelectorAll('.view-line span span')].map((s) => getComputedStyle(s).color)).size);
    return count >= 3 ? count : undefined;
  }, 10_000, 'syntax colors in the new window');
  if ((await contentTabs().count()) !== 0) throw new Error('the tab stayed in the pane');
  await aux.screenshot({ path: path.join(runDir, 'aux-window.png') });

  await aux.locator('.aux-body .view-lines').click();
  await aux.keyboard.press('Control+End');
  await aux.keyboard.type('// from the window');
  await waitFor(async () => (await aux.locator('.aux-title.dirty').count()) === 1, 5000, 'the unsaved mark in the window title');
  await press('Control+S', 'aux');
  await waitFor(() => readFileSync(sampleFile, 'utf8').includes('// from the window'), 5000, 'the save from the window');

  const closed = aux.waitForEvent('close');
  await aux.locator('.icon-move-back').click();
  await closed;
  await waitFor(async () => (await contentTabs().count()) === 1, 5000, 'the tab back in the pane');
  await waitFor(async () => (await editorText()).includes('from the window'), 5000, 'the editor back in the pane');
  return `${colors} token colors in the window`;
});

await step("closing a tab's own window closes the tab", async () => {
  const opened = app.waitForEvent('window');
  await page.locator('#content-pane .icon-pop-out').click();
  const aux = await opened;
  await aux.locator('.aux-body .monaco-editor').waitFor({ timeout: 10_000 });
  const closed = aux.waitForEvent('close');
  // Like the window's close button: the page may object (unsaved changes), then closes itself.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === 'about:blank')?.close());
  await closed;
  await waitFor(async () => (await contentTabs().count()) === 0, 5000, 'the tab to be gone');
});

await step('after an extension host crash and restart, open files come back with unsaved changes', async () => {
  await press('Control+P');
  await page.locator('.quick-input-filter').fill('sample.ts');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) > 0, 10_000, 'sample.ts in the list');
  await page.locator('.quick-input-filter').press('Enter');
  await waitFor(async () => (await editorText()).includes('answer'), 10_000, 'sample.ts in the pane');
  await page.locator('#content-pane .monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// survives the crash');
  await waitFor(async () => (await page.locator('#content-pane .content-tab.dirty').count()) === 1, 5000, 'the dirty tab');

  const killed = await app.evaluate(({ app: electronApp }) => {
    const host = electronApp.getAppMetrics().find((metric) => metric.name === 'ccshell extension host');
    if (host) process.kill(host.pid);
    return host !== undefined;
  });
  if (!killed) throw new Error('extension host process not found');
  const restart = page.locator('.banner-error .button');
  await restart.waitFor({ timeout: 15_000 });
  await restart.click();
  await waitFor(async () => (await page.locator('#content-pane .content-tab.dirty').count()) === 1, 30_000, 'the file back, dirty');
  await waitFor(async () => (await editorText()).includes('survives the crash'), 5000, 'the unsaved text back');
  if (readFileSync(sampleFile, 'utf8').includes('survives the crash')) throw new Error('the unsaved text reached the disk');
  // Leave it saved and closed for the next steps.
  await page.locator('#content-pane .monaco-editor .view-lines').click();
  await press('Control+S');
  await waitFor(async () => (await page.locator('#content-pane .content-tab.dirty').count()) === 0, 5000, 'the save');
  await press('Control+W');
  await waitFor(async () => (await contentTabs().count()) === 0, 5000, 'the tab to close');
});

await step('the title bar button toggles the empty content pane', async () => {
  await page.locator('.icon-content-pane').click();
  await waitFor(() => page.locator('#content-pane').isVisible(), 5000, 'the pane to show');
  await page.locator('.icon-content-pane').click();
  await waitFor(() => page.locator('#content-pane').isHidden(), 5000, 'the pane to hide');
});

// ---- settings ------------------------------------------------------------------------------

const readSettings = () => JSON.parse(readFileSync(settingsFile, 'utf8'));
const settingRow = (key) => page.locator(`#content-pane .setting-item[data-key="${key}"]`);

await step('Ctrl+, opens the settings editor; Editor: Font Size applies to the editor and resets', async () => {
  await press('Control+,');
  await page.locator('#content-pane .settings-editor').waitFor({ timeout: 10_000 });
  await page.locator('#content-pane .settings-search').fill('font size');
  await waitFor(() => settingRow('editor.fontSize').isVisible(), 5000, 'the Editor: Font Size row');
  if (await settingRow('editor.minimap.enabled').isVisible()) throw new Error('search did not filter');
  // The extension's settings are listed, except those for VS Code integration ccshell lacks.
  await page.locator('#content-pane .settings-search').fill('');
  await waitFor(async () => (await settingRow('claudeCode.useCtrlEnterToSend').count()) === 1, 10_000, "the extension's settings");
  if ((await settingRow('claudeCode.useTerminal').count()) !== 0) throw new Error('claudeCode.useTerminal is listed');
  await page.screenshot({ path: path.join(runDir, 'settings.png') });

  await settingRow('editor.fontSize').locator('.setting-input').fill('20');
  await waitFor(() => readSettings()['editor.fontSize'] === 20, 5000, 'editor.fontSize in settings.json');
  await waitFor(() => settingRow('editor.fontSize').evaluate((row) => row.classList.contains('modified')), 5000, 'the modified mark');

  await press('Control+P');
  await page.locator('.quick-input-filter').fill('sample.ts');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) > 0, 10_000, 'sample.ts in the list');
  await page.locator('.quick-input-filter').press('Enter');
  const fontSize = await waitFor(async () => {
    const lines = page.locator('#content-pane .content-editor:not([hidden]) .view-lines');
    const size = (await lines.count()) ? await lines.evaluate((element) => getComputedStyle(element).fontSize) : '';
    return size === '20px' ? size : undefined;
  }, 10_000, 'the editor at 20px');

  await page.locator('#content-pane .content-tab', { hasText: 'Settings' }).click();
  await settingRow('editor.fontSize').hover();
  await settingRow('editor.fontSize').locator('.setting-reset').click();
  await waitFor(() => readSettings()['editor.fontSize'] === undefined, 5000, 'editor.fontSize removed');
  return `editor ${fontSize}`;
});

await step('settings.json opens in the editor, validated against the settings schema', async () => {
  const original = readFileSync(settingsFile, 'utf8');
  const withError = { ...JSON.parse(original), 'editor.tabSize': 'wide' };
  writeFileSync(settingsFile, JSON.stringify(withError, null, 2), 'utf8');
  await page.locator('#content-pane .content-tab', { hasText: 'Settings' }).click();
  await page.locator('#content-pane .settings-open-json').click();
  await waitFor(async () => (await page.locator('#content-pane .content-tab.active .tab-label').innerText()) === 'settings.json', 10_000, 'the settings.json tab');
  // The JSON language service runs in its worker; its warning shows as a squiggle.
  await waitFor(
    async () => (await page.locator('#content-pane .content-editor:not([hidden]) :is(.squiggly-warning, .squiggly-error)').count()) > 0,
    15_000,
    'the schema warning on "wide"',
  );
  await page.screenshot({ path: path.join(runDir, 'settings-json.png') });
  writeFileSync(settingsFile, original, 'utf8');
  await waitFor(async () => !(await editorText()).includes('"wide"'), 10_000, 'the file back as it was');
  // Close settings.json, sample.ts and the settings editor.
  for (let i = 0; i < 3 && (await contentTabs().count()) > 0; i++) {
    await page.locator('#content-pane .content-tab.active .tab-close').click();
    await page.waitForTimeout(200);
  }
});

await page.screenshot({ path: path.join(runDir, 'final.png') });

await step('open conversations are restored after a restart', async () => {
  await press('Control+N');
  await waitFor(async () => (await tabCount()) === 2, 20_000, 'a second tab');
  // Let the panel save its state (PanelRestore debounces writes).
  await page.waitForTimeout(1500);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await waitFor(async () => (await tabCount()) === 2, 30_000, 'both tabs to come back');
  return `${await tabCount()} tabs restored`;
});

await step('Configure Display Language switches the shell to Chinese after a restart', async () => {
  await press('Control+Shift+P');
  const filter = page.locator('.quick-input-filter');
  await filter.waitFor({ timeout: 5000 });
  await filter.fill('Configure Display Language');
  await filter.press('Enter');
  await waitFor(async () => (await page.locator('.quick-input-item').count()) === 3, 5000, 'the three choices');
  await page.locator('.quick-input-filter').fill('中文');
  await page.locator('.quick-input-filter').press('Enter');
  const restart = page.locator('.toast .button', { hasText: 'Restart' });
  await waitFor(async () => (await restart.count()) > 0, 5000, 'the restart prompt');
  const saved = JSON.parse(readFileSync(settingsFile, 'utf8'))['ccshell.language'];
  if (saved !== 'zh-cn') throw new Error(`ccshell.language is ${saved}`);

  // What the Restart button does (app.relaunch), by hand: Playwright cannot follow a relaunch.
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await waitFor(() => webviewFrames().length >= 2, 30_000, 'the webviews to come back');
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (lang !== 'zh-CN') throw new Error(`html lang is ${lang}`);

  await press('Control+Shift+P');
  await page.locator('.quick-input-filter').waitFor({ timeout: 5000 });
  await page.locator('.quick-input-filter').fill('新建对话');
  const command = await waitFor(async () => {
    const rows = page.locator('.quick-input-item');
    return (await rows.count()) ? rows.first().innerText() : undefined;
  }, 5000, 'the Chinese command');
  await page.locator('.quick-input-filter').press('Escape');

  const menu = await withRecordedMenus(async () => {
    await rightClick(activeConversation());
    return waitFor(recordedMenu, 5000, 'the context menu');
  });
  const expected = ['将会话标签页添加到分组', '将会话标记为未读', '重命名会话标签页'];
  if (!expected.every((label) => menu.includes(label))) throw new Error(`menu was: ${menu.join(' | ')}`);
  return `palette: ${command.replace(/\s+/g, ' ')}; menu: ${menu.join(' | ')}`;
});

await app.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed. Artifacts: ${runDir}`);
if (failed === 0) {
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
