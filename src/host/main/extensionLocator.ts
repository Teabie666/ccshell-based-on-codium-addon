/**
 * Finds the Claude Code extension on disk.
 *
 * Order: `--extension-dir`, then the extension registries of local VSCodium / VS Code
 * installs. (M4 adds vilaus's own managed copy, downloaded from Open VSX, in front.)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readJsonFile } from '../node/jsonFile';

export const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';

export interface LocatedExtension {
  readonly path: string;
  readonly version: string;
  readonly source: string;
}

interface RegistryEntry {
  identifier?: { id?: string };
  version?: string;
  location?: { fsPath?: string; path?: string };
  relativeLocation?: string;
}

export function locateClaudeExtension(explicitDir?: string): LocatedExtension | undefined {
  if (explicitDir) {
    const version = readVersion(explicitDir);
    return version ? { path: explicitDir, version, source: '--extension-dir' } : undefined;
  }
  for (const dir of candidateExtensionDirs()) {
    const found = fromRegistry(dir) ?? fromDirectoryScan(dir);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function candidateExtensionDirs(): string[] {
  const home = os.homedir();
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const localPrograms = path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs');
  return [
    // Portable VSCodium / VS Code keep extensions next to the executable.
    path.join(programFiles, 'VSCodium', 'data', 'extensions'),
    path.join(localPrograms, 'VSCodium', 'data', 'extensions'),
    path.join(home, '.vscode-oss', 'extensions'),
    path.join(home, '.vscode', 'extensions'),
  ];
}

function fromRegistry(extensionsDir: string): LocatedExtension | undefined {
  const entries = readJsonFile<RegistryEntry[] | undefined>(path.join(extensionsDir, 'extensions.json'), undefined);
  if (!Array.isArray(entries)) {
    return undefined;
  }
  const entry = entries.find((e) => e.identifier?.id?.toLowerCase() === CLAUDE_EXTENSION_ID);
  if (!entry) {
    return undefined;
  }
  const dir = entry.relativeLocation
    ? path.join(extensionsDir, entry.relativeLocation)
    : uriPathToFsPath(entry.location?.fsPath ?? entry.location?.path);
  const version = dir ? readVersion(dir) : undefined;
  return dir && version ? { path: dir, version, source: extensionsDir } : undefined;
}

function fromDirectoryScan(extensionsDir: string): LocatedExtension | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(extensionsDir);
  } catch {
    return undefined;
  }
  const obsolete = readJsonFile<Record<string, boolean>>(path.join(extensionsDir, '.obsolete'), {});
  const candidates = names
    .filter((name) => name.toLowerCase().startsWith(`${CLAUDE_EXTENSION_ID}-`) && !obsolete[name])
    .map((name) => {
      const dir = path.join(extensionsDir, name);
      return { dir, version: readVersion(dir) };
    })
    .filter((c): c is { dir: string; version: string } => c.version !== undefined)
    .sort((a, b) => compareVersions(b.version, a.version));
  const best = candidates[0];
  return best ? { path: best.dir, version: best.version, source: extensionsDir } : undefined;
}

function readVersion(dir: string): string | undefined {
  const pkg = readJsonFile<{ version?: unknown; main?: unknown } | undefined>(
    path.join(dir, 'package.json'),
    undefined,
  );
  if (!pkg || typeof pkg.version !== 'string' || typeof pkg.main !== 'string') {
    return undefined;
  }
  return fs.existsSync(path.join(dir, pkg.main)) ? pkg.version : undefined;
}

/** `/c:/Program Files/x` (a URI path) -> `c:\Program Files\x`. */
function uriPathToFsPath(p: string | undefined): string | undefined {
  if (!p) {
    return undefined;
  }
  const trimmed = /^\/[a-zA-Z]:/.test(p) ? p.slice(1) : p;
  return path.normalize(trimmed);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
