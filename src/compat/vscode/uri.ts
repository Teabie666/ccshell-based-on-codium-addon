/**
 * `vscode.Uri`. vscode-uri is the very implementation VS Code ships, so `toString()`,
 * `fsPath` and friends match byte for byte. VS Code exposes `joinPath` as a static on
 * Uri, while vscode-uri keeps it in `Utils`; we add the static once.
 */

import { URI, Utils } from 'vscode-uri';

interface UriStatics {
  joinPath(base: URI, ...pathSegments: string[]): URI;
}

if (!Object.hasOwn(URI, 'joinPath')) {
  Object.defineProperty(URI, 'joinPath', {
    value: (base: URI, ...pathSegments: string[]): URI => Utils.joinPath(base, ...pathSegments),
    enumerable: false,
  });
}

export const Uri = URI as typeof URI & UriStatics;
export type Uri = URI;

/** Accepts a Uri or a plain path string and returns a Uri. */
export function toUri(value: Uri | string): Uri {
  return typeof value === 'string' ? Uri.file(value) : value;
}
