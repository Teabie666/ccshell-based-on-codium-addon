/**
 * Holds the HTML each webview should show and renders it with the ccshell bootstrap
 * injected. The bootstrap (src/host/webview/bootstrap.ts) provides `acquireVsCodeApi`,
 * theme variables and VS Code's default webview styles before the extension's own
 * scripts run, mirroring what VS Code's `pre/index.html` does.
 */

import type { ThemeData, WebviewBootstrapData, WebviewDocument } from '../../platform/protocol';

export class WebviewDocumentStore {
  private readonly documents = new Map<string, WebviewDocument>();

  constructor(
    private readonly bootstrapSource: string,
    private readonly getTheme: () => ThemeData,
  ) {}

  set(document: WebviewDocument): void {
    this.documents.set(document.webviewId, document);
  }

  release(webviewId: string): void {
    this.documents.delete(webviewId);
  }

  /** Union of every live webview's resource roots; `ccw://res/` serves only files under these. */
  resourceRoots(): string[] {
    const roots = new Set<string>();
    for (const document of this.documents.values()) {
      for (const root of document.resourceRoots) {
        roots.add(root);
      }
    }
    return [...roots];
  }

  render(webviewId: string): string | undefined {
    const document = this.documents.get(webviewId);
    if (!document) {
      return undefined;
    }
    const data: WebviewBootstrapData = {
      webviewId,
      state: document.state,
      theme: this.getTheme(),
    };
    return injectBootstrap(allowInlineFonts(document.html), this.bootstrapSource, data);
  }
}

/**
 * The Claude Code webview embeds its icon font (codicon) as a `data:` URL but declares
 * `font-src <cspSource>`, which blocks it, so icons render as empty boxes. We add `data:`
 * to font-src only; every other directive stays exactly as the extension wrote it.
 */
export function allowInlineFonts(html: string): string {
  return html.replace(/(<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>)/i, (meta) =>
    // Sources run to the next `;` or the end of the (double-quoted) content attribute;
    // single quotes are part of sources like 'self'.
    meta.replace(/font-src([^;"]*)/i, (directive, sources: string) =>
      /(^|\s)data:(\s|$)/.test(sources) ? directive : `font-src${sources.trimEnd()} data:`,
    ),
  );
}

/**
 * Inserts the bootstrap script as the first child of <head>. That puts it ahead of the
 * page's CSP <meta> (a meta CSP only governs content after it), and we still copy the
 * page's nonce onto it so it stays valid if a page puts its CSP first.
 */
export function injectBootstrap(html: string, bootstrapSource: string, data: WebviewBootstrapData): string {
  const nonce = findNonce(html);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  // An inline script ends at the first "</script", wherever it appears.
  const safeSource = bootstrapSource.replace(/<\/script/gi, '<\\/script');
  const script =
    `<script${nonceAttr}>window.__ccwBootstrap=${serializeForScript(data)};\n` +
    `${safeSource}</script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}

export function findNonce(html: string): string | undefined {
  const fromCsp = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(html);
  if (fromCsp) {
    return fromCsp[1];
  }
  const fromScript = /<script[^>]*\snonce="([^"]+)"/i.exec(html);
  return fromScript?.[1];
}

/** JSON that is safe inside a <script> element. */
export function serializeForScript(value: unknown): string {
  // U+2028/U+2029 are line terminators inside <script>; built with fromCharCode so the
  // source file itself never contains the invisible characters.
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replaceAll(lineSeparator, '\\u2028')
    .replaceAll(paragraphSeparator, '\\u2029');
}
