/**
 * URL conventions for the `ccw:` scheme, shared by main (which serves them), the
 * extension host (`asWebviewUri`, `cspSource`) and the renderer (iframe sources).
 * Pure string functions: no Node or DOM dependency.
 */

export const CCW_SCHEME = 'ccw';
export const APP_ORIGIN = `${CCW_SCHEME}://app`;
/** What `Webview.cspSource` returns: matches every ccw: URL. */
export const WEBVIEW_CSP_SOURCE = `${CCW_SCHEME}:`;
export const WEBVIEW_ID_PREFIX = 'wv';
export const WEBVIEW_ID_PATTERN = /^wv[0-9a-f]+$/;

export function webviewDocumentUrl(webviewId: string, generation: number): string {
  return `${CCW_SCHEME}://${webviewId}/index.html?v=${generation}`;
}

/** The webview id in a webview document URL (`ccw://wv1f/index.html?v=2` -> `wv1f`). */
export function webviewIdFromUrl(url: string): string | undefined {
  const prefix = `${CCW_SCHEME}://`;
  if (!url.startsWith(prefix)) {
    return undefined;
  }
  const host = url.slice(prefix.length).split(/[/?#]/, 1)[0] ?? '';
  return WEBVIEW_ID_PATTERN.test(host) ? host : undefined;
}

/** `C:\Program Files\x.js` -> `ccw://res/C%3A/Program%20Files/x.js` */
export function resourceUrlForFsPath(fsPath: string): string {
  const forward = fsPath.replace(/\\/g, '/');
  const withSlash = forward.startsWith('/') ? forward : `/${forward}`;
  return `${CCW_SCHEME}://res${withSlash.split('/').map(encodeURIComponent).join('/')}`;
}
