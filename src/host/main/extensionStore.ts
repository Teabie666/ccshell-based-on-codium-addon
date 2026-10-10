/**
 * The copies of the Claude Code extension that vilaus installs itself, from Open VSX or a
 * .vsix file: `<data>\extensions\anthropic.claude-code-<version>\` (the package's
 * `extension/` folder), and `state.json` next to them saying which one is current, which
 * one is kept to roll back to, and which one becomes current at the next start. Switching
 * only ever happens at startup, before an extension host has loaded anything. Main is the
 * only user; the normal and the administrator instance share the folder, so changes are
 * made to the state as it is on disk, and a version another process has files open in is
 * never deleted. No Electron here.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  checkPackage,
  keptVersions,
  parseManagedExtensions,
  rollBackTo,
  switchToPending,
  vsixIdentity,
  type ExtensionErrorCode,
  type ManagedExtensions,
} from '../../platform/extensionUpdates';
import type { ILogger } from '../../platform/log';
import { readJsonFile, writeFileAtomic, writeFileAtomicSync } from '../node/jsonFile';
import { CLAUDE_EXTENSION_ID, type LocatedExtension } from './extensionLocator';

export class ExtensionError extends Error {
  constructor(
    readonly code: ExtensionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionError';
  }
}

/** Windows 10 and 11 ship bsdtar, which unpacks zip files; a .vsix is one. */
export function systemTar(): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
}

const STATE_FILE = 'state.json';
/** Packages are unpacked here first, so a half-unpacked one never looks installed. */
const STAGING_PREFIX = '.staging-';
/** A folder is renamed to this before it is deleted (see removeUnkept). */
const REMOVING_PREFIX = '.removing-';
/** Downloads in progress; see ExtensionUpdater. */
export const DOWNLOADS_DIR = '.downloads';
const UNPACK_TIMEOUT_MS = 10 * 60_000;

export class ExtensionStore {
  private stateValue: ManagedExtensions;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly dir: string,
    readonly targetPlatform: string,
    private readonly logger: ILogger,
    private readonly tar = systemTar(),
  ) {
    this.stateValue = parseManagedExtensions(readJsonFile(path.join(dir, STATE_FILE), undefined));
  }

  get state(): ManagedExtensions {
    return this.stateValue;
  }

  versionDir(version: string): string {
    return path.join(this.dir, `${CLAUDE_EXTENSION_ID}-${version}`);
  }

  /** Whether `version` is unpacked and complete. */
  isInstalled(version: string): boolean {
    const dir = this.versionDir(version);
    let pkg: { version?: unknown; main?: unknown };
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as typeof pkg;
    } catch {
      return false;
    }
    return pkg.version === version && typeof pkg.main === 'string' && fs.existsSync(path.join(dir, pkg.main));
  }

  /**
   * At startup, before any extension host: switches to the pending version and removes the
   * versions no longer kept, with anything a crash left behind. Returns the current copy.
   */
  prepare(): LocatedExtension | undefined {
    const before = this.stateValue;
    let state = switchToPending(before, (version) => this.isInstalled(version));
    if (state.previous !== undefined && !this.isInstalled(state.previous)) {
      const { previous: _missing, ...rest } = state;
      state = rest;
    }
    if (state.current !== undefined && !this.isInstalled(state.current)) {
      // Deleted by hand: back to the one before, else to none (then a VSCodium copy may be found).
      this.logger.warn(`Claude Code ${state.current} is missing from ${this.dir}`);
      const { current: _missing, previous, ...rest } = state;
      state = previous !== undefined ? { ...rest, current: previous } : rest;
    }
    if (JSON.stringify(state) !== JSON.stringify(before)) {
      if (state.current !== before.current) {
        this.logger.info(`Claude Code ${before.current ?? '(none)'} -> ${state.current ?? '(none)'}`);
      }
      this.stateValue = state;
      writeFileAtomicSync(path.join(this.dir, STATE_FILE), serialize(state));
    }
    this.removeUnkept();
    return this.currentCopy();
  }

  /** The current copy, as it is now (no switching). */
  currentCopy(): LocatedExtension | undefined {
    const current = this.stateValue.current;
    return current === undefined || !this.isInstalled(current)
      ? undefined
      : { path: this.versionDir(current), version: current, source: this.dir, kind: 'managed' };
  }

  /**
   * Unpacks a .vsix and makes its version current at the next start. With `expected`, the
   * package must be that version (a download from Open VSX). Returns the version.
   */
  async install(vsixFile: string, expected?: string): Promise<string> {
    const version = await this.add(vsixFile, expected, async (staging) => {
      await this.unpack(vsixFile, staging);
      try {
        return vsixIdentity(await fs.promises.readFile(path.join(staging, 'extension.vsixmanifest'), 'utf8'));
      } catch {
        throw new ExtensionError('badPackage', `${vsixFile} has no extension.vsixmanifest`);
      }
    });
    await this.select(version);
    return version;
  }

  /**
   * Copies an extension folder another editor installed (VSCodium's, say) into the store, so
   * that it stays even when that editor updates or removes its copy. Does not select it.
   * Returns the version.
   */
  async adopt(folder: string, expected?: string): Promise<string> {
    return this.add(folder, expected, async (staging) => {
      try {
        await fs.promises.cp(folder, path.join(staging, 'extension'), { recursive: true });
      } catch (error) {
        throw new ExtensionError('extract', `cannot copy ${folder}: ${(error as Error).message}`);
      }
      // VS Code keeps the package's manifest as `.vsixmanifest`; an older install may lack it.
      const manifest = await fs.promises.readFile(path.join(staging, 'extension', '.vsixmanifest'), 'utf8').catch(() => '');
      return vsixIdentity(manifest);
    });
  }

  /**
   * Puts a package into the store: `fill` brings it into a staging folder as `extension/`
   * and returns the identity of its vsixmanifest; it is checked there and then moved to its
   * version's folder, so a half-copied package never looks installed.
   */
  private async add(
    source: string,
    expected: string | undefined,
    fill: (staging: string) => Promise<Readonly<Record<string, string>>>,
  ): Promise<string> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const staging = await fs.promises.mkdtemp(path.join(this.dir, STAGING_PREFIX));
    try {
      const identity = await fill(staging);
      const unpacked = path.join(staging, 'extension');
      const manifest = readJsonFile<unknown>(path.join(unpacked, 'package.json'), undefined);
      const checked = checkPackage(manifest, identity, this.targetPlatform);
      if ('error' in checked) {
        throw new ExtensionError(checked.error, `${source} is not the Claude Code extension for ${this.targetPlatform}`);
      }
      const { version } = checked;
      if (expected !== undefined && version !== expected) {
        throw new ExtensionError('badPackage', `expected Claude Code ${expected}, ${source} has ${version}`);
      }
      const main = (manifest as { main: string }).main;
      if (!fs.existsSync(path.join(unpacked, main))) {
        throw new ExtensionError('badPackage', `${source} lacks its main file ${main}`);
      }
      // A version already installed is kept as it is: it may be the one running.
      if (!this.isInstalled(version)) {
        const target = this.versionDir(version);
        await fs.promises.rm(target, { recursive: true, force: true });
        await fs.promises.rename(unpacked, target);
      }
      this.logger.info(`added Claude Code ${version} from ${source}`);
      return version;
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch((error: unknown) => {
        this.logger.warn(`cannot remove ${staging}`, error);
      });
    }
  }

  /** Makes an installed version current at the next start (or keeps the current one). */
  async select(version: string): Promise<void> {
    await this.update((current) => {
      const { pending: _replaced, ...rest } = current;
      const state: ManagedExtensions = version === rest.current ? rest : { ...rest, pending: version };
      // Chosen on purpose: no longer skipped.
      const { skipped, ...unskipped } = state;
      return skipped === version ? unskipped : state;
    });
  }

  /** Goes back to an installed version at the next start; automatic updates skip the current one. */
  async rollBackTo(version: string): Promise<void> {
    if (!this.isInstalled(version)) {
      throw new ExtensionError('noPrevious', `Claude Code ${version} is not in ${this.dir}`);
    }
    await this.update((current) => {
      this.logger.info(`going back from Claude Code ${current.current ?? '(none)'} to ${version} at the next start`);
      return rollBackTo(current, version);
    });
  }

  /**
   * Before the first managed copy replaces another editor's: that copy (adopted) is the
   * version to go back to. Nothing changes once there is a managed current version.
   */
  async keepAsPrevious(version: string): Promise<void> {
    await this.update((current) =>
      current.current === undefined && this.isInstalled(version) ? { ...current, previous: version } : undefined,
    );
  }

  /** The current version activated: it is the one to come back to. */
  async markGood(version: string): Promise<void> {
    await this.update((current) =>
      current.current === version && current.lastGood !== version ? { ...current, lastGood: version } : undefined,
    );
  }

  /**
   * Changes the state as it is on disk now (the other instance may have changed it since),
   * one change at a time; `change` returns undefined to leave it as it is.
   */
  private update(change: (state: ManagedExtensions) => ManagedExtensions | undefined): Promise<void> {
    const file = path.join(this.dir, STATE_FILE);
    const run = this.writeQueue.then(async () => {
      const onDisk = fs.existsSync(file) ? parseManagedExtensions(readJsonFile(file, undefined)) : this.stateValue;
      const next = change(onDisk);
      this.stateValue = next ?? onDisk;
      if (next !== undefined) {
        await writeFileAtomic(file, serialize(next));
      }
    });
    // A failed write must not fail the ones queued after it.
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  private unpack(vsixFile: string, into: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        this.tar,
        ['-xf', vsixFile, '-C', into, 'extension', 'extension.vsixmanifest'],
        { windowsHide: true, timeout: UNPACK_TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }
          const detail = String(stderr).trim() || error.message;
          // bsdtar names the members it did not find; anything else means it is no zip file.
          const code: ExtensionErrorCode = /not found in archive/i.test(detail) ? 'badPackage' : 'extract';
          reject(new ExtensionError(code, `cannot unpack ${vsixFile}: ${detail}`));
        },
      );
    });
  }

  private removeUnkept(): void {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    const kept = new Set(keptVersions(this.stateValue).map((version) => path.basename(this.versionDir(version))));
    for (const name of names) {
      const stale =
        name.startsWith(STAGING_PREFIX) ||
        name.startsWith(REMOVING_PREFIX) ||
        name === DOWNLOADS_DIR ||
        (name.startsWith(`${CLAUDE_EXTENSION_ID}-`) && !kept.has(name));
      if (!stale) {
        continue;
      }
      // Renamed first: Windows refuses to rename a folder with a file open in it, so a version
      // the other instance runs (or a download it is writing) stays whole.
      const doomed = name.startsWith(REMOVING_PREFIX) ? name : `${REMOVING_PREFIX}${process.pid}-${Date.now()}-${name}`;
      try {
        if (doomed !== name) {
          fs.renameSync(path.join(this.dir, name), path.join(this.dir, doomed));
        }
      } catch {
        this.logger.info(`${name} in ${this.dir} is in use; kept for now`);
        continue;
      }
      try {
        fs.rmSync(path.join(this.dir, doomed), { recursive: true, force: true });
        this.logger.info(`removed ${name} from ${this.dir}`);
      } catch (error) {
        // Left as .removing-*: the next start tries again.
        this.logger.warn(`cannot remove ${name} from ${this.dir}`, error);
      }
    }
  }
}

function serialize(state: ManagedExtensions): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}
