/**
 * The copies of the Claude Code extension that vilaus installs itself, from Open VSX or a
 * .vsix file: `<data>\extensions\anthropic.claude-code-<version>\` (the package's
 * `extension/` folder), and `state.json` next to them saying which one is current, which
 * one is kept to roll back to, and which one becomes current at the next start. Switching
 * only ever happens at startup, before an extension host has loaded anything. Main is the
 * only user. No Electron here.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  checkPackage,
  keptVersions,
  parseManagedExtensions,
  rollBack,
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
    await fs.promises.mkdir(this.dir, { recursive: true });
    const staging = await fs.promises.mkdtemp(path.join(this.dir, STAGING_PREFIX));
    try {
      await this.unpack(vsixFile, staging);
      const unpacked = path.join(staging, 'extension');
      const manifest = readJsonFile<unknown>(path.join(unpacked, 'package.json'), undefined);
      let identity: Readonly<Record<string, string>>;
      try {
        identity = vsixIdentity(await fs.promises.readFile(path.join(staging, 'extension.vsixmanifest'), 'utf8'));
      } catch {
        throw new ExtensionError('badPackage', `${vsixFile} has no extension.vsixmanifest`);
      }
      const checked = checkPackage(manifest, identity, this.targetPlatform);
      if ('error' in checked) {
        throw new ExtensionError(checked.error, `${vsixFile} is not the Claude Code extension for ${this.targetPlatform}`);
      }
      const { version } = checked;
      if (expected !== undefined && version !== expected) {
        throw new ExtensionError('badPackage', `expected Claude Code ${expected}, the package has ${version}`);
      }
      const main = (manifest as { main: string }).main;
      if (!fs.existsSync(path.join(unpacked, main))) {
        throw new ExtensionError('badPackage', `${vsixFile} lacks its main file ${main}`);
      }
      // A version already installed is kept as it is: it may be the one running.
      if (!this.isInstalled(version)) {
        const target = this.versionDir(version);
        await fs.promises.rm(target, { recursive: true, force: true });
        await fs.promises.rename(unpacked, target);
      }
      await this.select(version);
      this.logger.info(`installed Claude Code ${version} from ${vsixFile}`);
      return version;
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch((error: unknown) => {
        this.logger.warn(`cannot remove ${staging}`, error);
      });
    }
  }

  /** Makes an installed version current at the next start (or keeps the current one). */
  async select(version: string): Promise<void> {
    const { pending: _replaced, ...rest } = this.stateValue;
    const state: ManagedExtensions = version === rest.current ? rest : { ...rest, pending: version };
    // Chosen on purpose: no longer skipped.
    const { skipped, ...unskipped } = state;
    await this.write(skipped === version ? unskipped : state);
  }

  /** Goes back to the previous version at the next start. Returns it, or undefined if there is none. */
  async rollBack(): Promise<string | undefined> {
    const next = rollBack(this.stateValue);
    if (next?.pending === undefined || !this.isInstalled(next.pending)) {
      return undefined;
    }
    await this.write(next);
    this.logger.info(`rolling back Claude Code ${this.stateValue.current} -> ${next.pending} at the next start`);
    return next.pending;
  }

  /** The current version activated: it is the one to come back to. */
  async markGood(version: string): Promise<void> {
    if (this.stateValue.current === version && this.stateValue.lastGood !== version) {
      await this.write({ ...this.stateValue, lastGood: version });
    }
  }

  private write(state: ManagedExtensions): Promise<void> {
    this.stateValue = state;
    const file = path.join(this.dir, STATE_FILE);
    const write = this.writeQueue.then(() => writeFileAtomic(file, serialize(state)));
    // A failed write must not fail the ones queued after it.
    this.writeQueue = write.catch(() => undefined);
    return write;
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
        name === DOWNLOADS_DIR ||
        (name.startsWith(`${CLAUDE_EXTENSION_ID}-`) && !kept.has(name));
      if (!stale) {
        continue;
      }
      try {
        fs.rmSync(path.join(this.dir, name), { recursive: true, force: true });
        this.logger.info(`removed ${name} from ${this.dir}`);
      } catch (error) {
        // Something still has a file open; next start then.
        this.logger.warn(`cannot remove ${name} from ${this.dir}`, error);
      }
    }
  }
}

function serialize(state: ManagedExtensions): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}
