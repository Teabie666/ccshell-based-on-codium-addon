/**
 * The tables that show the Claude Code extension's UI text in the display language (M3.5,
 * see platform/extensionStrings.ts). Bundled into main only, which hands them to the webviews
 * and the extension host. Maintained with tools/extension-strings and `npm run nls`.
 */

import type { UiLanguage } from '../platform/nls';
import type { ExtensionTranslations } from '../platform/protocol';
import zhCn from './zh-cn.extension.json';

export function extensionTranslations(language: UiLanguage): ExtensionTranslations | undefined {
  return language === 'zh-cn' ? (zhCn as ExtensionTranslations) : undefined;
}
