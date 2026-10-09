/**
 * Loads Monaco on first use: the editor core with all its editor features but none of its
 * languages (Shiki highlights; ccshell runs no language services), its stylesheet, its
 * worker, and its own UI strings in the display language.
 */

import type { UiLanguage } from '../../platform/nls';

export type MonacoApi = typeof import('monaco-editor/editor/editor.api');

let loading: Promise<MonacoApi> | undefined;

export function loadMonaco(language: UiLanguage): Promise<MonacoApi> {
  loading ??= load(language);
  return loading;
}

async function load(language: UiLanguage): Promise<MonacoApi> {
  const stylesheet = addStylesheet('monaco.css');
  // Monaco reads its strings while its modules evaluate, so the pack must come first.
  if (language === 'zh-cn') {
    await import('monaco-editor/nls/lang/zh-cn');
  }
  (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: (_moduleId: string, label: string) => new Worker(new URL('editor.worker.js', document.baseURI), { name: label }),
  };
  const monaco = await import('monaco-editor/editor/editor.api');
  await import('monaco-editor/features/register.all');
  await stylesheet;
  return monaco;
}

function addStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    // Monaco renders without its styles too, just badly; never block the editor on this.
    link.addEventListener('load', () => resolve());
    link.addEventListener('error', () => resolve());
    // Before styles.css, so the shell's rules (square corners...) win over Monaco's.
    const shellStyles = document.querySelector('link[href="styles.css"]');
    document.head.insertBefore(link, shellStyles);
  });
}
