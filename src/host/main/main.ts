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
import { HELP_TEXT, parseCliArgs, userArguments, type CliArgs } from './cli';
import { locateClaudeExtension } from './extensionLocator';
import { ShellApp } from './shellApp';

/** What a second start hands to the running instance (Electron's `additionalData`). */
interface SecondStart {
  readonly argv: readonly string[];
  readonly cwd: string;
}

function isSecondStart(value: unknown): value is SecondStart {
  const data = value as Partial<SecondStart> | null;
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof data.cwd === 'string' &&
    Array.isArray(data.argv) &&
    data.argv.every((arg) => typeof arg === 'string')
  );
}

function versionText(args: CliArgs): string {
  const extension = locateClaudeExtension(args.extensionDir);
  return [
    `Vilausity ${app.getVersion()}`,
    `Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, Node ${process.versions.node}`,
    extension ? `Claude Code ${extension.version} (${extension.path})` : 'Claude Code: not found',
    '',
  ].join('\n');
}

function main(): void {
  const argv = userArguments(process.argv, app.isPackaged);
  const args = parseCliArgs(argv);
  if (args.help || args.version) {
    process.stdout.write(args.help ? HELP_TEXT : versionText(args));
    app.exit(0);
    return;
  }

  // Must happen before the app is ready.
  registerCcwSchemePrivileges();
  // No application menu: it would bring Electron's default accelerators (Ctrl+W, Ctrl+R...).
  Menu.setApplicationMenu(null);

  const dataRoot = args.userDataDir ?? path.join(app.getPath('appData'), 'Vilausity');
  const paths = createAppPaths(dataRoot);
  app.setPath('userData', dataRoot);
  app.setPath('sessionData', paths.chromium);

  // One instance per data folder (the lock lives in userData): a second start hands its
  // arguments to the running one and quits, before it writes anything.
  const secondStart: SecondStart = { argv, cwd: process.cwd() };
  if (!app.requestSingleInstanceLock(secondStart)) {
    app.quit();
    return;
  }

  const logLevel = parseLogLevel(args.logLevel, LogLevel.Info);
  const sink = new FileLogSink(path.join(paths.sessionLogs, 'main.log'), !app.isPackaged);
  const logger = new Logger(sink, 'main', () => logLevel);
  setUnexpectedErrorHandler((error) => logger.error('unexpected error in listener', error));
  process.on('uncaughtException', (error) => logger.error('uncaught exception', error));
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', reason));

  let shellApp: ShellApp | undefined;
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    shellApp?.flushSync();
    sink.flushSync();
  });
  app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
    if (!isSecondStart(additionalData)) {
      logger.warn('a second start sent no arguments');
      return;
    }
    const forwarded = parseCliArgs(additionalData.argv, additionalData.cwd);
    void started.then(() => shellApp?.handleCommandLine(forwarded));
  });

  void app
    .whenReady()
    .then(async () => {
      pruneOldLogs(paths);
      logger.info(`vilaus ${app.getVersion()} starting; data in ${dataRoot}`);
      shellApp = new ShellApp({ args, paths, appDir: __dirname, logger, logLevel });
      await shellApp.start();
      markStarted();
    })
    .catch((error: unknown) => {
      logger.error('fatal startup error', error);
      sink.flushSync();
      app.exit(1);
    });
}

main();
