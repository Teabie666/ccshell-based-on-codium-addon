/**
 * Built-in themes are JSON snapshots of VS Code's theme variables, produced by
 * tools/theme-capture and shipped in `<app>/themes/<id>.json`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILogger } from '../../platform/log';
import type { ThemeData, ThemeSummary } from '../../platform/protocol';
import { readJsonFile } from '../node/jsonFile';

export const DEFAULT_THEME_ID = 'dark-modern';

export function listThemeSummaries(themesDir: string): ThemeSummary[] {
  let names: string[];
  try {
    names = fs.readdirSync(themesDir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const theme = readJsonFile<ThemeData | undefined>(path.join(themesDir, name), undefined);
    return theme ? [{ id: theme.id, label: theme.label, kind: theme.kind }] : [];
  });
}

/** VS Code's defaults on Windows. Fonts are user settings, never part of a captured theme. */
const DEFAULT_FONTS = {
  family: '"Segoe WPC", "Segoe UI", sans-serif',
  size: 13,
  editorFamily: "Consolas, 'Courier New', monospace",
  editorSize: 14,
};

/** Adds the `--vscode-*font*` variables from settings (VS Code setting names) or defaults. */
export function withFontVariables(theme: ThemeData, settings: Readonly<Record<string, unknown>>): ThemeData {
  const text = (key: string, fallback: string): string => {
    const value = settings[key];
    return typeof value === 'string' && value.trim() ? value : fallback;
  };
  const size = (key: string, fallback: number): string => {
    const value = settings[key];
    return `${typeof value === 'number' && value > 0 ? value : fallback}px`;
  };
  return {
    ...theme,
    variables: {
      ...theme.variables,
      'vscode-font-family': text('workbench.fontFamily', DEFAULT_FONTS.family),
      'vscode-font-weight': 'normal',
      'vscode-font-size': size('workbench.fontSize', DEFAULT_FONTS.size),
      'vscode-editor-font-family': text('editor.fontFamily', DEFAULT_FONTS.editorFamily),
      'vscode-editor-font-weight': text('editor.fontWeight', 'normal'),
      'vscode-editor-font-size': size('editor.fontSize', DEFAULT_FONTS.editorSize),
    },
  };
}

export function loadTheme(themesDir: string, id: string, logger: ILogger): ThemeData {
  const theme = readJsonFile<ThemeData | undefined>(path.join(themesDir, `${id}.json`), undefined);
  if (theme && typeof theme.variables === 'object') {
    return theme;
  }
  if (id !== DEFAULT_THEME_ID) {
    logger.warn(`theme ${id} not found; falling back to ${DEFAULT_THEME_ID}`);
    return loadTheme(themesDir, DEFAULT_THEME_ID, logger);
  }
  logger.warn('no captured themes found; using the minimal fallback theme');
  return FALLBACK_THEME;
}

/** Enough to keep the UI legible before themes have been captured. */
const FALLBACK_THEME: ThemeData = {
  id: 'fallback-dark',
  label: 'Fallback Dark',
  kind: 'vscode-dark',
  variables: {
    'vscode-font-family': '"Segoe WPC", "Segoe UI", sans-serif',
    'vscode-font-weight': 'normal',
    'vscode-font-size': '13px',
    'vscode-editor-font-family': 'Consolas, "Courier New", monospace',
    'vscode-editor-font-weight': 'normal',
    'vscode-editor-font-size': '14px',
    'vscode-foreground': '#cccccc',
    'vscode-descriptionForeground': '#9d9d9d',
    'vscode-errorForeground': '#f85149',
    'vscode-focusBorder': '#0078d4',
    'vscode-editor-background': '#1f1f1f',
    'vscode-editor-foreground': '#cccccc',
    'vscode-sideBar-background': '#181818',
    'vscode-titleBar-activeBackground': '#181818',
    'vscode-titleBar-activeForeground': '#cccccc',
    'vscode-panel-border': '#2b2b2b',
    'vscode-input-background': '#313131',
    'vscode-input-foreground': '#cccccc',
    'vscode-input-border': '#3c3c3c',
    'vscode-button-background': '#0078d4',
    'vscode-button-foreground': '#ffffff',
    'vscode-button-hoverBackground': '#026ec1',
    'vscode-textLink-foreground': '#4daafc',
    'vscode-textLink-activeForeground': '#4daafc',
    'vscode-scrollbarSlider-background': 'rgba(121, 121, 121, 0.4)',
    'vscode-scrollbarSlider-hoverBackground': 'rgba(100, 100, 100, 0.7)',
    'vscode-scrollbarSlider-activeBackground': 'rgba(191, 191, 191, 0.4)',
    'vscode-widget-shadow': 'rgba(0, 0, 0, 0.36)',
    'vscode-tab-activeBackground': '#1f1f1f',
    'vscode-tab-inactiveBackground': '#181818',
    'vscode-tab-activeForeground': '#ffffff',
    'vscode-tab-inactiveForeground': '#9d9d9d',
    'vscode-tab-border': '#2b2b2b',
  },
};
