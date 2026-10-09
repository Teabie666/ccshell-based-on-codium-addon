/**
 * Defaults of settings that main applies and the settings editor shows: they must agree.
 */

/** VS Code's default fonts on Windows. Main turns the font settings (or these) into the `--vscode-*font*` theme variables. */
export const DEFAULT_FONTS = {
  family: '"Segoe WPC", "Segoe UI", sans-serif',
  size: 13,
  editorFamily: "Consolas, 'Courier New', monospace",
  editorSize: 14,
  editorWeight: 'normal',
} as const;

/** The color theme when `ccshell.theme` is not set. */
export const DEFAULT_THEME_ID = 'dark-modern';
