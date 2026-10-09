/**
 * Electron main entry point. Keeps to startup order only; the real work is in ShellApp.
 */

import * as path from 'node:path';
import { app, Menu } from 'electron';
import { setUnexpectedErrorHandler } from '../../platform/event';
import { Logger, LogLevel, parseLogLevel } from '../../platform/log';
import { FileLogSink } from '../node/fileLogSink';
import { createAppPaths, pruneOldLogs } from './appPaths';
import { registerCcwSchemePrivileges } from './ccwProtocol';
import { parseCliArgs } from './cli';
import { ShellApp } from './shellApp';

// Must happen before the app is ready.
registerCcwSchemePrivileges();
// No application menu: it would bring Electron's default accelerators (Ctrl+W, Ctrl+R...).
Menu.setApplicationMenu(null);

const args = parseCliArgs(process.argv.slice(app.isPackaged ? 1 : 2));
const dataRoot = args.userDataDir ?? path.join(app.getPath('appData'), 'Vilausity');
const paths = createAppPaths(dataRoot);
app.setPath('userData', dataRoot);
app.setPath('sessionData', paths.chromium);

const logLevel = parseLogLevel(args.logLevel, LogLevel.Info);
const sink = new FileLogSink(path.join(paths.sessionLogs, 'main.log'), !app.isPackaged);
const logger = new Logger(sink, 'main', () => logLevel);
setUnexpectedErrorHandler((error) => logger.error('unexpected error in listener', error));
process.on('uncaughtException', (error) => logger.error('uncaught exception', error));
process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', reason));

let shellApp: ShellApp | undefined;

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  shellApp?.flushSync();
  sink.flushSync();
});

void app
  .whenReady()
  .then(async () => {
    pruneOldLogs(paths);
    logger.info(`vilaus ${app.getVersion()} starting; data in ${dataRoot}`);
    shellApp = new ShellApp({ args, paths, appDir: __dirname, logger, logLevel });
    await shellApp.start();
  })
  .catch((error: unknown) => {
    logger.error('fatal startup error', error);
    sink.flushSync();
    app.exit(1);
  });
