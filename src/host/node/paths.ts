/** Filesystem path helpers shared by main and the extension host. */

import * as crypto from 'node:crypto';
import * as path from 'node:path';

/** Windows paths compare case-insensitively; normalise before comparing or hashing. */
export function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isSubPath(child: string, parent: string): boolean {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  if (c === p) {
    return true;
  }
  const withSep = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(withSep);
}

/** Stable short id for a workspace folder, used to key per-workspace state. */
export function workspaceKey(folders: readonly string[]): string {
  const basis = folders.length === 0 ? '<empty>' : folders.map(normalizeForCompare).join('|');
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
}
