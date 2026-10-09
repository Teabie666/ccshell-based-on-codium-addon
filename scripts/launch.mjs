// Starts the built app in development, from a clean environment.
//   node scripts/launch.mjs [vilaus args...]
// VS Code-family extension hosts (and agents running inside them) export
// ELECTRON_RUN_AS_NODE=1, which would make electron.exe behave as plain Node.
import { spawn } from 'node:child_process';
import path from 'node:path';
import electronPath from 'electron';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE' || name.toUpperCase().startsWith('VSCODE_')) {
    delete env[name];
  }
}

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
