/**
 * Environment hygiene for child processes.
 *
 * When ccshell is started from inside a VS Code-family extension host (for example by an
 * AI agent running in VSCodium), it inherits ELECTRON_RUN_AS_NODE and VSCODE_* variables.
 * Passed on, they make Electron children run as plain Node and make the Claude CLI believe
 * it runs in a VS Code terminal. Strip them before spawning anything.
 */

const LEAKED_PREFIXES = ['VSCODE_'];
const LEAKED_NAMES = new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE']);

export function cleanEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    const upper = name.toUpperCase();
    if (LEAKED_NAMES.has(upper) || LEAKED_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
      continue;
    }
    env[name] = value;
  }
  return env;
}
