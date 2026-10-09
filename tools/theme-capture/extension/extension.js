// Development-only VSCodium extension, loaded with --extensionDevelopmentPath by run.mjs.
// For each built-in theme it switches the theme FOR ITS OWN TEMP WORKSPACE ONLY
// (ConfigurationTarget.Workspace, never the user's settings), opens a webview and records
// the CSS variables and classes VS Code injected, then closes its window.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readConfig() {
  const file = path.join(__dirname, 'capture-config.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

async function waitForTheme(expectedLabel) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = vscode.workspace.getConfiguration('workbench').get('colorTheme');
    if (current === expectedLabel) {
      break;
    }
    await sleep(100);
  }
  // Give the workbench time to push the new colors to webviews.
  await sleep(1200);
}

async function captureWebview() {
  const panel = vscode.window.createWebviewPanel('ccshellThemeCapture', 'Theme capture', vscode.ViewColumn.One, {
    enableScripts: true,
  });
  const nonce = Math.random().toString(36).slice(2);
  panel.webview.html = `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';">
</head><body><script nonce="${nonce}">
const api = acquireVsCodeApi();
setTimeout(() => {
  const style = document.documentElement.style;
  const variables = {};
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    if (name.startsWith('--')) variables[name.slice(2)] = style.getPropertyValue(name).trim();
  }
  api.postMessage({
    variables,
    bodyClass: document.body.className,
    kind: document.body.dataset.vscodeThemeKind,
    themeName: document.body.dataset.vscodeThemeName,
    themeId: document.body.dataset.vscodeThemeId,
    defaultStyles: (document.getElementById('_defaultStyles') || {}).textContent || null,
  });
}, 600);
</script></body></html>`;
  const data = await new Promise((resolve) => panel.webview.onDidReceiveMessage(resolve));
  panel.dispose();
  return data;
}

exports.activate = async function activate() {
  const config = readConfig();
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder || !samePath(folder.uri.fsPath, config.workspace)) {
    // Not our temp workspace: do nothing at all.
    return;
  }
  const settings = vscode.workspace.getConfiguration();
  const results = [];
  try {
    for (const theme of config.themes) {
      await settings.update('workbench.colorTheme', theme.settingsId, vscode.ConfigurationTarget.Workspace);
      await waitForTheme(theme.settingsId);
      const snapshot = await captureWebview();
      results.push({ ...theme, ...snapshot });
    }
    fs.writeFileSync(
      config.out,
      JSON.stringify(
        { capturedAt: new Date().toISOString(), vscodeVersion: vscode.version, appName: vscode.env.appName, themes: results },
        null,
        2,
      ),
      'utf8',
    );
  } catch (error) {
    fs.writeFileSync(`${config.out}.error.txt`, String((error && error.stack) || error), 'utf8');
  } finally {
    await settings.update('workbench.colorTheme', undefined, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('workbench.action.closeWindow');
  }
};

exports.deactivate = function deactivate() {};
