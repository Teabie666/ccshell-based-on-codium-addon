/**
 * Environment-neutral logging. Each process supplies a LogSink (a file in main and the
 * extension host, the devtools console in the renderer); everything else talks to ILogger.
 */

export enum LogLevel {
  Trace = 0,
  Debug = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
  Off = 5,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.Trace]: 'trace',
  [LogLevel.Debug]: 'debug',
  [LogLevel.Info]: 'info',
  [LogLevel.Warn]: 'warn',
  [LogLevel.Error]: 'error',
  [LogLevel.Off]: 'off',
};

export function logLevelName(level: LogLevel): string {
  return LEVEL_NAMES[level];
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const match = Object.entries(LEVEL_NAMES).find(([, name]) => name === value?.toLowerCase());
  return match ? (Number(match[0]) as LogLevel) : fallback;
}

export interface LogSink {
  write(level: LogLevel, scope: string, message: string): void;
}

export interface ILogger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** A logger whose lines are tagged `parent/scope`. */
  child(scope: string): ILogger;
}

export function formatLogArgs(message: string, args: readonly unknown[]): string {
  if (args.length === 0) {
    return message;
  }
  return [message, ...args.map(formatValue)].join(' ');
}

function formatValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class Logger implements ILogger {
  constructor(
    private readonly sink: LogSink,
    private readonly scope: string,
    private readonly getLevel: () => LogLevel,
  ) {}

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
    this.log(LogLevel.Warn, message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Error, message, args);
  }

  child(scope: string): ILogger {
    return new Logger(this.sink, `${this.scope}/${scope}`, this.getLevel);
  }

  private log(level: LogLevel, message: string, args: readonly unknown[]): void {
    if (level < this.getLevel()) {
      return;
    }
    this.sink.write(level, this.scope, formatLogArgs(message, args));
  }
}

/** Formats one log line; shared by the file sinks so every log looks the same. */
export function formatLogLine(level: LogLevel, scope: string, message: string, now = new Date()): string {
  const time = now.toISOString();
  return `${time} [${logLevelName(level).padEnd(5)}] [${scope}] ${message}\n`;
}

export const NullLogger: ILogger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return NullLogger;
  },
};
