/**
 * Loads Monaco on first use: the editor core with all its editor features, its JSON
 * language service (for settings.json), none of its other languages (Shiki highlights;
 * vilaus runs no other language services), its stylesheet, its workers, and its own UI
 * strings in the display language.
 */

import type { UiLanguage } from '../../platform/nls';

export type MonacoApi = typeof import('monaco-editor/editor/editor.api');
export type JsonLanguage = typeof import('monaco-editor/languages/features/json/register');

let loading: Promise<{ monaco: MonacoApi; json: JsonLanguage }> | undefined;

export function loadMonaco(language: UiLanguage): Promise<{ monaco: MonacoApi; json: JsonLanguage }> {
  loading ??= load(language);
  return loading;
}

async function load(language: UiLanguage): Promise<{ monaco: MonacoApi; json: JsonLanguage }> {
  const stylesheet = addStylesheet('monaco.css');
  // Monaco reads its strings while its modules evaluate, so the pack must come first.
  if (language === 'zh-cn') {
    await import('monaco-editor/nls/lang/zh-cn');
  }
  (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: (_moduleId: string, label: string) =>
      new Worker(new URL(label === 'json' ? 'json.worker.js' : 'editor.worker.js', document.baseURI), { name: label }),
  };
  const monaco = await import('monaco-editor/editor/editor.api');
  await import('monaco-editor/features/register.all');
  const json = await import('monaco-editor/languages/features/json/register');
  // Shiki tokenizes JSON too; the language service brings completion, hovers and validation.
  json.jsonDefaults.setModeConfiguration({
    documentFormattingEdits: true,
    documentRangeFormattingEdits: true,
    completionItems: true,
    hovers: true,
    documentSymbols: true,
    tokens: false,
    colors: true,
    foldingRanges: true,
    diagnostics: true,
    selectionRanges: true,
  });
  await stylesheet;
  return { monaco, json };
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
