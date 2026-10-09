/** A LogSink that appends to a file, buffering writes so logging never blocks the caller. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatLogLine, LogLevel, type LogSink } from '../../platform/log';

export class FileLogSink implements LogSink {
  private buffer: string[] = [];
  private flushScheduled = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    readonly filePath: string,
    private readonly mirrorToConsole = false,
  ) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  write(level: LogLevel, scope: string, message: string): void {
    const line = formatLogLine(level, scope, message);
    if (this.mirrorToConsole) {
      (level >= LogLevel.Warn ? process.stderr : process.stdout).write(line);
    }
    this.buffer.push(line);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setTimeout(() => void this.flush(), 50);
    }
  }

  /** Writes everything buffered so far. Safe to await during shutdown. */
  flush(): Promise<void> {
    this.flushScheduled = false;
    if (this.buffer.length === 0) {
      return this.writing;
    }
    const chunk = this.buffer.join('');
    this.buffer = [];
    this.writing = this.writing.then(() =>
      fs.promises.appendFile(this.filePath, chunk, 'utf8').catch((error: unknown) => {
        process.stderr.write(`[vilaus] cannot write log ${this.filePath}: ${String(error)}\n`);
      }),
    );
    return this.writing;
  }

  /** Synchronous flush for process exit paths where promises will not run. */
  flushSync(): void {
    if (this.buffer.length === 0) {
      return;
    }
    try {
      fs.appendFileSync(this.filePath, this.buffer.join(''), 'utf8');
    } catch {
      // Nothing sensible left to do at exit.
    }
    this.buffer = [];
  }
}
