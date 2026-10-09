/**
 * The language packs, bundled into the processes that show UI text (main and renderer).
 * Each pack maps `namespace.key` to text; see platform/nls.ts. Keep the JSON sorted by key
 * (`npm run nls -- --sort`).
 */

import type { LanguagePack, UiLanguage } from '../platform/nls';
import zhCn from './zh-cn.json';

export function languagePack(language: UiLanguage): LanguagePack {
  return language === 'zh-cn' ? zhCn : {};
}
