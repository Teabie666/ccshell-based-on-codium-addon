/**
 * Where vilaus keeps its data. Everything the app writes lives under one root
 * (`%APPDATA%\Vilausity` by default) so an install in Program Files stays read-only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AppPaths {
  readonly root: string;
  readonly settingsFile: string;
  readonly globalStateFile: string;
  /** Chromium's own profile data (cache, local storage), kept apart from ours. */
  readonly chromium: string;
  readonly logsRoot: string;
  /** Logs for this run only. */
  readonly sessionLogs: string;
  /** `ExtensionContext.globalStorageUri` for the Claude Code extension. */
  readonly extensionGlobalStorage: string;
  workspaceStateFile(workspaceKey: string): string;
  /** `ExtensionContext.storageUri` for the Claude Code extension in one workspace. */
  extensionWorkspaceStorage(workspaceKey: string): string;
}

const EXTENSION_ID = 'anthropic.claude-code';
const KEPT_LOG_SESSIONS = 10;

export function createAppPaths(root: string, startedAt = new Date()): AppPaths {
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const logsRoot = path.join(root, 'logs');
  return {
    root,
    settingsFile: path.join(root, 'settings.json'),
    globalStateFile: path.join(root, 'state', 'global.json'),
    chromium: path.join(root, 'chromium'),
    logsRoot,
    sessionLogs: path.join(logsRoot, stamp),
    extensionGlobalStorage: path.join(root, 'globalStorage', EXTENSION_ID),
    workspaceStateFile: (key) => path.join(root, 'state', 'workspaces', `${key}.json`),
    extensionWorkspaceStorage: (key) => path.join(root, 'workspaceStorage', key, EXTENSION_ID),
  };
}

/** Deletes all but the newest log session folders. */
export function pruneOldLogs(paths: AppPaths): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(paths.logsRoot);
  } catch {
    return;
  }
  const sessions = entries.filter((name) => /^\d{8}T\d{6}$/.test(name)).sort();
  for (const name of sessions.slice(0, Math.max(0, sessions.length - KEPT_LOG_SESSIONS))) {
    fs.rmSync(path.join(paths.logsRoot, name), { recursive: true, force: true });
  }
}
