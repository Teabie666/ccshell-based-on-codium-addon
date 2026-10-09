/** Reading and atomically writing JSON files. */

import * as fs from 'node:fs';
import * as path from 'node:path';

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // A corrupt file is kept aside rather than silently overwritten.
      try {
        fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch {
        // Ignore: we fall back either way.
      }
    }
    return fallback;
  }
}

/** Write to a temp file then rename, so a crash mid-write never leaves a truncated file. */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temp, contents, 'utf8');
  await fs.promises.rename(temp, filePath);
}

export function writeFileAtomicSync(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, contents, 'utf8');
  fs.renameSync(temp, filePath);
}
