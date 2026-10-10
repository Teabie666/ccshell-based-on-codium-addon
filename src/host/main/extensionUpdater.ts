/**
 * Updates the Claude Code extension from Open VSX: asks for the latest (or the pinned)
 * version, downloads the .vsix, checks it against the sha256 Open VSX publishes, and hands
 * it to the ExtensionStore, which makes it current at the next start. Also installs a .vsix
 * the user picks. Reports what it does as ExtensionStatus for the settings editor.
 * No Electron: `fetch` is Electron's net.fetch in the app (it uses the system proxy).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Emitter, type Event } from '../../platform/event';
import { parseOpenVsxRelease, releaseUrl, shouldInstall, type OpenVsxRelease } from '../../platform/extensionUpdates';
import { Disposable } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import type { ExtensionActivity, ExtensionInstallResult, ExtensionStatus } from '../../platform/protocol';
import type { LocatedExtension } from './extensionLocator';
import { DOWNLOADS_DIR, ExtensionError, type ExtensionStore } from './extensionStore';

export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface UpdateSettings {
  readonly openVsxUrl: string;
  /** A version to stay on; undefined follows the latest. */
  readonly pinned: string | undefined;
}

export interface ExtensionUpdaterOptions {
  readonly store: ExtensionStore;
  readonly fetch: Fetch;
  readonly targetPlatform: string;
  /** The copy the windows run; undefined when none was found. */
  readonly running: LocatedExtension | undefined;
  readonly settings: () => UpdateSettings;
  readonly logger: ILogger;
}

/** Progress is reported at most this often. */
const PROGRESS_INTERVAL_MS = 200;

export class ExtensionUpdater extends Disposable {
  private activity: ExtensionActivity = { kind: 'idle' };
  private lastCheck: ExtensionStatus['lastCheck'];
  private running: Promise<ExtensionInstallResult> | undefined;
  private readonly abort = new AbortController();
  private readonly changeEmitter = this.register(new Emitter<void>());
  readonly onDidChange: Event<void> = this.changeEmitter.event;

  constructor(private readonly options: ExtensionUpdaterOptions) {
    super();
    this.register({ dispose: () => this.abort.abort() });
  }

  get updatesApply(): boolean {
    return this.options.running?.kind !== 'cli';
  }

  status(): ExtensionStatus {
    const running = this.options.running;
    return {
      ...(running ? { running: { version: running.version, path: running.path, kind: running.kind } } : {}),
      managed: this.options.store.state,
      activity: this.activity,
      ...(this.lastCheck ? { lastCheck: this.lastCheck } : {}),
      updatesApply: this.updatesApply,
    };
  }

  /**
   * Asks Open VSX and installs what it offers if it is newer (or, pinned, if it differs).
   * `manual`: asked for by the user, so a version rolled back from is installed anyway.
   * One at a time: a check while another runs gets that one's result.
   */
  check(manual: boolean): Promise<ExtensionInstallResult> {
    this.running ??= this.exclusive(async () => {
      const result = await this.checkNow(manual);
      this.lastCheck = { ...result, at: Date.now(), manual };
      return result;
    });
    return this.running;
  }

  /** Installs a .vsix the user picked. */
  installFile(file: string): Promise<ExtensionInstallResult> {
    if (this.running) {
      return Promise.resolve({ outcome: 'failed', code: 'busy', message: 'another install is running' });
    }
    this.running = this.exclusive(async () => {
      this.setActivity({ kind: 'installing', label: path.basename(file) });
      try {
        return { outcome: 'installed', version: await this.options.store.install(file) };
      } catch (error) {
        return this.failure(error);
      }
    });
    return this.running;
  }

  async rollBack(): Promise<string | undefined> {
    const version = await this.options.store.rollBack();
    this.changeEmitter.fire();
    return version;
  }

  private async exclusive(work: () => Promise<ExtensionInstallResult>): Promise<ExtensionInstallResult> {
    try {
      return await work();
    } finally {
      this.running = undefined;
      this.setActivity({ kind: 'idle' });
    }
  }

  private async checkNow(manual: boolean): Promise<ExtensionInstallResult> {
    const { openVsxUrl, pinned } = this.options.settings();
    const { store, targetPlatform } = this.options;
    this.setActivity({ kind: 'checking' });
    try {
      const response = await this.request(releaseUrl(openVsxUrl, targetPlatform, pinned));
      let release: OpenVsxRelease | undefined;
      try {
        release = parseOpenVsxRelease(await response.json(), targetPlatform);
      } catch {
        release = undefined;
      }
      if (!release) {
        throw new ExtensionError('notFound', `${response.url || openVsxUrl} offers no Claude Code for ${targetPlatform}`);
      }
      const { version } = release;
      const wanted = shouldInstall({
        state: store.state,
        running: this.options.running?.version,
        available: version,
        pinned: pinned !== undefined,
        manual,
      });
      if (!wanted) {
        this.options.logger.info(`Claude Code ${version} on Open VSX: nothing to install`);
        return { outcome: 'upToDate', version };
      }
      if (store.isInstalled(version)) {
        await store.select(version);
      } else {
        const file = await this.download(release);
        this.setActivity({ kind: 'installing', label: version });
        try {
          await store.install(file, version);
        } finally {
          await fs.promises.rm(file, { force: true }).catch(() => undefined);
        }
      }
      return { outcome: 'installed', version };
    } catch (error) {
      return this.failure(error);
    }
  }

  /** Downloads a release next to the store, checking its sha256 on the way. Returns the file. */
  private async download(release: OpenVsxRelease): Promise<string> {
    const { version } = release;
    const expected = (await (await this.request(release.sha256)).text()).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      throw new ExtensionError('checksum', `Open VSX published no usable sha256 for ${version}`);
    }
    const response = await this.request(release.download);
    if (!response.body) {
      throw new ExtensionError('network', `${release.download}: empty response`);
    }
    const total = Number(response.headers.get('content-length')) || undefined;
    const dir = path.join(this.options.store.dir, DOWNLOADS_DIR);
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${version}.vsix`);
    const hash = crypto.createHash('sha256');
    let received = 0;
    let reported = 0;
    this.setActivity({ kind: 'downloading', version, received, ...(total ? { total } : {}) });
    const source = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
    source.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      const now = Date.now();
      if (now - reported >= PROGRESS_INTERVAL_MS) {
        reported = now;
        this.setActivity({ kind: 'downloading', version, received, ...(total ? { total } : {}) });
      }
    });
    try {
      await pipeline(source, fs.createWriteStream(file));
    } catch (error) {
      await fs.promises.rm(file, { force: true }).catch(() => undefined);
      throw new ExtensionError('network', `downloading ${release.download} failed: ${messageOf(error)}`);
    }
    const actual = hash.digest('hex');
    if (actual !== expected) {
      await fs.promises.rm(file, { force: true }).catch(() => undefined);
      throw new ExtensionError('checksum', `the download of ${version} has sha256 ${actual}, Open VSX says ${expected}`);
    }
    return file;
  }

  private async request(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.options.fetch(url, { signal: this.abort.signal });
    } catch (error) {
      throw new ExtensionError('network', `${url}: ${messageOf(error)}`);
    }
    if (response.status === 404) {
      throw new ExtensionError('notFound', `${url}: not found`);
    }
    if (!response.ok) {
      throw new ExtensionError('network', `${url}: HTTP ${response.status}`);
    }
    return response;
  }

  private failure(error: unknown): ExtensionInstallResult {
    this.options.logger.warn('installing Claude Code failed', error);
    return error instanceof ExtensionError
      ? { outcome: 'failed', code: error.code, message: error.message }
      : { outcome: 'failed', code: 'extract', message: messageOf(error) };
  }

  private setActivity(activity: ExtensionActivity): void {
    this.activity = activity;
    this.changeEmitter.fire();
  }
}

function messageOf(error: unknown): string {
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  const message = error instanceof Error ? error.message : String(error);
  return cause instanceof Error ? `${message} (${cause.message})` : message;
}
