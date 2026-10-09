/**
 * The editor settings ccshell honours (VS Code's names and defaults), and how they become
 * Monaco options. Fonts reach Monaco through the theme's font variables (main computes them
 * from these same settings), so webviews and editors agree on them.
 */

import type { SettingDefinition, SettingsService } from '../../core/settings';
import { DEFAULT_FONTS } from '../../platform/defaults';
import { t } from './messages';

/** Keys whose change concerns editors. */
export function isEditorSetting(key: string): boolean {
  return key.startsWith('editor.') || key.startsWith('diffEditor.');
}

export function editorSettingDefinitions(): SettingDefinition[] {
  const text = t('sectionTextEditor');
  const diff = t('sectionDiffEditor');
  let order = 0;
  const editor = (key: string, schema: SettingDefinition['schema']): SettingDefinition => ({ key, schema, section: text, order: order++ });
  const diffEditor = (key: string, schema: SettingDefinition['schema']): SettingDefinition => ({ key, schema, section: diff, order: order++ });
  return [
    editor('editor.fontFamily', { type: 'string', default: DEFAULT_FONTS.editorFamily, description: t('fontFamily') }),
    editor('editor.fontSize', { type: 'number', default: DEFAULT_FONTS.editorSize, minimum: 6, maximum: 100, description: t('fontSize') }),
    editor('editor.fontWeight', {
      type: 'string',
      default: DEFAULT_FONTS.editorWeight,
      enum: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
      description: t('fontWeight'),
    }),
    editor('editor.lineHeight', { type: 'number', default: 0, minimum: 0, maximum: 150, description: t('lineHeight') }),
    editor('editor.fontLigatures', { type: 'boolean', default: false, description: t('fontLigatures') }),
    editor('editor.tabSize', { type: 'number', default: 4, minimum: 1, maximum: 100, description: t('tabSize') }),
    editor('editor.insertSpaces', { type: 'boolean', default: true, description: t('insertSpaces') }),
    editor('editor.detectIndentation', { type: 'boolean', default: true, description: t('detectIndentation') }),
    editor('editor.wordWrap', {
      type: 'string',
      default: 'off',
      enum: ['off', 'on', 'wordWrapColumn', 'bounded'],
      enumDescriptions: [t('wordWrapOff'), t('wordWrapOn'), t('wordWrapColumn'), t('wordWrapBounded')],
      description: t('wordWrap'),
    }),
    editor('editor.wordWrapColumn', { type: 'number', default: 80, minimum: 1, description: t('wordWrapColumnSetting') }),
    editor('editor.lineNumbers', { type: 'string', default: 'on', enum: ['off', 'on', 'relative', 'interval'], description: t('lineNumbers') }),
    editor('editor.minimap.enabled', { type: 'boolean', default: true, description: t('minimap') }),
    editor('editor.renderWhitespace', {
      type: 'string',
      default: 'selection',
      enum: ['none', 'boundary', 'selection', 'trailing', 'all'],
      description: t('renderWhitespace'),
    }),
    editor('editor.bracketPairColorization.enabled', { type: 'boolean', default: true, description: t('bracketPairs') }),
    editor('editor.cursorBlinking', {
      type: 'string',
      default: 'blink',
      enum: ['blink', 'smooth', 'phase', 'expand', 'solid'],
      description: t('cursorBlinking'),
    }),
    editor('editor.smoothScrolling', { type: 'boolean', default: false, description: t('smoothScrolling') }),
    editor('editor.scrollBeyondLastLine', { type: 'boolean', default: true, description: t('scrollBeyondLastLine') }),
    diffEditor('diffEditor.fontFamily', { type: 'string', default: '', description: t('diffFontFamily') }),
    diffEditor('diffEditor.fontSize', { type: 'number', default: 0, minimum: 0, maximum: 100, description: t('diffFontSize') }),
    diffEditor('diffEditor.renderSideBySide', { type: 'boolean', default: true, description: t('renderSideBySide') }),
    diffEditor('diffEditor.useInlineViewWhenSpaceIsLimited', { type: 'boolean', default: true, description: t('inlineWhenNarrow') }),
    diffEditor('diffEditor.ignoreTrimWhitespace', { type: 'boolean', default: true, description: t('ignoreTrimWhitespace') }),
    diffEditor('diffEditor.wordWrap', {
      type: 'string',
      default: 'inherit',
      enum: ['off', 'on', 'inherit'],
      description: t('diffWordWrap'),
    }),
  ];
}

/** Monaco options from the editor settings, fonts excepted (they come from the theme). */
export function editorOptions(settings: SettingsService): Record<string, unknown> {
  return {
    lineHeight: settings.get('editor.lineHeight', 0),
    fontLigatures: settings.get('editor.fontLigatures', false),
    wordWrap: settings.get('editor.wordWrap', 'off'),
    wordWrapColumn: settings.get('editor.wordWrapColumn', 80),
    lineNumbers: settings.get('editor.lineNumbers', 'on'),
    minimap: { enabled: settings.get('editor.minimap.enabled', true) },
    renderWhitespace: settings.get('editor.renderWhitespace', 'selection'),
    bracketPairColorization: { enabled: settings.get('editor.bracketPairColorization.enabled', true) },
    cursorBlinking: settings.get('editor.cursorBlinking', 'blink'),
    smoothScrolling: settings.get('editor.smoothScrolling', false),
    scrollBeyondLastLine: settings.get('editor.scrollBeyondLastLine', true),
  };
}

/** The diff editor's own options, on top of `editorOptions`; its own font when set, else the editor's. */
export function diffEditorOptions(settings: SettingsService): Record<string, unknown> {
  const options: Record<string, unknown> = {
    renderSideBySide: settings.get('diffEditor.renderSideBySide', true),
    useInlineViewWhenSpaceIsLimited: settings.get('diffEditor.useInlineViewWhenSpaceIsLimited', true),
    ignoreTrimWhitespace: settings.get('diffEditor.ignoreTrimWhitespace', true),
    diffWordWrap: settings.get('diffEditor.wordWrap', 'inherit'),
  };
  const fontFamily = settings.get<unknown>('diffEditor.fontFamily', '');
  const fontSize = settings.get<unknown>('diffEditor.fontSize', 0);
  if (typeof fontFamily === 'string' && fontFamily.trim()) {
    options.fontFamily = fontFamily;
  }
  if (typeof fontSize === 'number' && fontSize > 0) {
    options.fontSize = fontSize;
  }
  return options;
}

/** Indentation of a text model: detected from its text, or the configured one. */
export function indentation(settings: SettingsService): { tabSize: number; insertSpaces: boolean; detect: boolean } {
  return {
    tabSize: settings.get('editor.tabSize', 4),
    insertSpaces: settings.get('editor.insertSpaces', true),
    detect: settings.get('editor.detectIndentation', true),
  };
}
