/**
 * Whether Claude Code will find Git for Windows. It uses Git to track changes and Git Bash to
 * run commands; without it, Claude runs commands in PowerShell instead. Looked for where
 * Claude Code looks: CLAUDE_CODE_GIT_BASH_PATH, then PATH. (A Git installed but not on PATH
 * is not found by Claude Code either.)
 */

import * as path from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

/** The git.exe (or the configured bash.exe) found, or undefined. */
export function findGit(env: Environment, exists: (file: string) => boolean): string | undefined {
  const bash = env.CLAUDE_CODE_GIT_BASH_PATH;
  if (bash && exists(bash)) {
    return bash;
  }
  // process.env ignores case on Windows; a plain object (tests) may say Path.
  const searchPath = env.PATH ?? env.Path ?? '';
  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    const git = path.join(dir, 'git.exe');
    if (exists(git)) {
      return git;
    }
  }
  return undefined;
}
