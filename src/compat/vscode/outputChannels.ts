/** `window.createOutputChannel`. Each channel is a log file in this run's log folder. */

import type * as vscode from 'vscode';
import { Emitter, type Event } from '../../platform/event';
import { formatLogArgs } from '../../platform/log';
import type { OutputSink } from './host';
import { LogLevel } from './types';

const LEVEL_TAGS: Record<LogLevel, string> = {
  [LogLevel.Off]: 'off',
  [LogLevel.Trace]: 'trace',
  [LogLevel.Debug]: 'debug',
  [LogLevel.Info]: 'info',
  [LogLevel.Warning]: 'warning',
  [LogLevel.Error]: 'error',
};

export class OutputChannelImpl {
  private readonly levelEmitter = new Emitter<LogLevel>();
  readonly onDidChangeLogLevel: Event<LogLevel> = this.levelEmitter.event;
  logLevel: LogLevel = LogLevel.Info;

  constructor(
    readonly name: string,
    private readonly sink: OutputSink,
    private readonly onShow: (channel: OutputChannelImpl) => void,
  ) {}

  get filePath(): string {
    return this.sink.filePath;
  }

  append(value: string): void {
    this.sink.append(value);
  }

  appendLine(value: string): void {
    this.sink.append(`${value}\n`);
  }

  replace(value: string): void {
    this.sink.append(`${value}\n`);
  }

  clear(): void {}

  show(): void {
    this.onShow(this);
  }

  hide(): void {}

  dispose(): void {
    this.levelEmitter.dispose();
    this.sink.dispose();
  }

  trace(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Trace, message, args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Debug, message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Info, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Warning, message, args);
  }

  error(error: string | Error, ...args: unknown[]): void {
    const message = typeof error === 'string' ? error : (error.stack ?? error.message);
    this.log(LogLevel.Error, message, args);
  }

  private log(level: LogLevel, message: string, args: readonly unknown[]): void {
    if (level < this.logLevel) {
      return;
    }
    const time = new Date().toISOString().replace('T', ' ').replace('Z', '');
    this.sink.append(`${time} [${LEVEL_TAGS[level]}] ${formatLogArgs(message, args)}\n`);
  }
}

export function asVsCodeChannel(channel: OutputChannelImpl): vscode.LogOutputChannel {
  return channel as unknown as vscode.LogOutputChannel;
}
