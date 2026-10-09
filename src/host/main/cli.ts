/** Command-line arguments. See `vilaus --help` (M4) for the full list. */

import * as path from 'node:path';
import { parseArgs } from 'node:util';

export interface CliArgs {
  /** Workspace folder to open; defaults to the user's home directory. */
  readonly folder?: string;
  /** Load the Claude Code extension from this directory instead of the managed copy. */
  readonly extensionDir?: string;
  /** Use a separate data directory (settings, state, logs), e.g. for tests. */
  readonly userDataDir?: string;
  readonly logLevel?: string;
  readonly theme?: string;
  readonly devtools: boolean;
  /** Open the window on a display other than the primary one, if there is one (tests do). */
  readonly secondaryDisplay: boolean;
}

/**
 * `argv` is everything after the executable (and after the app path in development),
 * so callers pass `process.argv.slice(app.isPackaged ? 1 : 2)`.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: [...argv],
    strict: false,
    allowPositionals: true,
    options: {
      folder: { type: 'string' },
      'extension-dir': { type: 'string' },
      'user-data-dir': { type: 'string' },
      'log-level': { type: 'string' },
      theme: { type: 'string' },
      devtools: { type: 'boolean' },
      'secondary-display': { type: 'boolean' },
    },
  });
  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  const resolvePath = (p: string | undefined): string | undefined => (p ? path.resolve(p) : undefined);

  return {
    folder: resolvePath(str(values.folder) ?? positionals.find((p) => !p.startsWith('-'))),
    extensionDir: resolvePath(str(values['extension-dir'])),
    userDataDir: resolvePath(str(values['user-data-dir'])),
    logLevel: str(values['log-level']),
    theme: str(values.theme),
    devtools: values.devtools === true,
    secondaryDisplay: values['secondary-display'] === true,
  };
}
