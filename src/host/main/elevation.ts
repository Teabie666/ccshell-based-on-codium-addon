/**
 * The administrator instance: whether this process runs elevated, and how to start an
 * elevated one. An elevated instance keeps its state and Chromium profile apart (AppPaths),
 * so it runs next to the normal one; settings, providers and extensions are shared.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Whether this process has administrator rights. `VILAUS_ELEVATED=1` or `0` says so instead:
 * tests set it, since they may be started from an elevated shell.
 */
export function isElevated(env: Environment = process.env, platform = process.platform): boolean {
  const forced = env.VILAUS_ELEVATED;
  if (forced === '1' || forced === '0') {
    return forced === '1';
  }
  if (platform !== 'win32') {
    return false;
  }
  // Only SYSTEM and Administrators may list the system profile, and a filtered (not
  // elevated) token has Administrators as deny-only.
  try {
    fs.readdirSync(path.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'config', 'systemprofile'));
    return true;
  } catch {
    return false;
  }
}

/** One argument of a Windows command line, quoted the way CommandLineToArgvW reads it back. */
export function quoteWindowsArgument(arg: string): string {
  if (arg.length > 0 && !/[\s"]/.test(arg)) {
    return arg;
  }
  let quoted = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      backslashes++;
      continue;
    }
    // Backslashes before a quote are escaped, and so is the quote; elsewhere they are literal.
    quoted += char === '"' ? `${'\\'.repeat(backslashes * 2 + 1)}"` : `${'\\'.repeat(backslashes)}${char}`;
    backslashes = 0;
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

/**
 * The PowerShell script that starts `executable` with `args` elevated: Windows asks the user
 * to confirm (UAC). Start-Process hands ArgumentList on as one command line.
 */
export function elevatedStartScript(executable: string, args: readonly string[]): string {
  const literal = (text: string): string => `'${text.replace(/'/g, "''")}'`;
  const commandLine = args.map(quoteWindowsArgument).join(' ');
  return `Start-Process -FilePath ${literal(executable)} -ArgumentList ${literal(commandLine)} -Verb RunAs`;
}
