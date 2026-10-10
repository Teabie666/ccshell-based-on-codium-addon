/**
 * One key for Electron's safeStorage in the normal and the administrator instance.
 *
 * Chromium allows one process per profile, so the administrator instance has a profile of
 * its own; but safeStorage encrypts with a key kept in the profile's `Local State`
 * (`os_crypt.encrypted_key`, itself encrypted with DPAPI for this Windows user). Both
 * instances run as the same user, so either can decrypt that key: at startup, before
 * Chromium reads `Local State`, the instance takes the other one's key. The normal instance's
 * key wins; the administrator's is taken only while the normal instance has none.
 *
 * This relies on Chromium's `Local State` format. If it changes, the administrator instance
 * simply cannot read the API keys the normal one stored (they can be entered again there).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILogger } from '../../platform/log';
import { writeFileAtomicSync } from '../node/jsonFile';

const LOCAL_STATE = 'Local State';

type Json = Record<string, unknown>;

function readLocalState(profile: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(profile, LOCAL_STATE), 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
  } catch {
    return undefined;
  }
}

function osCrypt(state: Json | undefined): Json {
  const value = state?.os_crypt;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function encryptedKey(state: Json | undefined): string | undefined {
  const key = osCrypt(state).encrypted_key;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

/**
 * `own` and `other`: the two instances' Chromium profiles. Writes `own`'s `Local State` when
 * it should use the other key. Returns whether it did.
 */
export function shareSafeStorageKey(own: string, other: string, ownIsAdministrator: boolean, logger: ILogger): boolean {
  const ownState = readLocalState(own);
  const ownKey = encryptedKey(ownState);
  const otherKey = encryptedKey(readLocalState(other));
  const wanted = ownIsAdministrator ? (otherKey ?? ownKey) : (ownKey ?? otherKey);
  if (wanted === undefined || wanted === ownKey) {
    return false;
  }
  const next: Json = { ...ownState, os_crypt: { ...osCrypt(ownState), encrypted_key: wanted } };
  try {
    writeFileAtomicSync(path.join(own, LOCAL_STATE), JSON.stringify(next));
  } catch (error) {
    logger.warn('cannot share the key of safeStorage with the other instance', error);
    return false;
  }
  logger.info(`safeStorage: using the key of the ${ownIsAdministrator ? 'normal' : 'administrator'} instance`);
  return true;
}
