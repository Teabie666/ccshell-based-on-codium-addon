/** Renderer log sink: the devtools console. */

import { Logger, LogLevel, type ILogger, type LogSink } from '../platform/log';

const sink: LogSink = {
  write(level, scope, message) {
    const line = `[${scope}] ${message}`;
    if (level >= LogLevel.Error) {
      console.error(line);
    } else if (level >= LogLevel.Warn) {
      console.warn(line);
    } else {
      console.log(line);
    }
  },
};

export function createRendererLogger(scope: string): ILogger {
  return new Logger(sink, scope, () => LogLevel.Info);
}
