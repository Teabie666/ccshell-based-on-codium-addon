/**
 * Keys and lookup for the table that shows the Claude Code extension's own UI text in the
 * display language (M3.5). The table holds no English. A text's key is its length and a
 * hash of it, after whitespace is normalized; a template with one variable ("3 days ago")
 * is keyed by the lengths of the text before and after the variable and a hash of that
 * text. The extraction tool (tools/extension-strings) and the lookup at run time both use
 * these functions, so their keys agree.
 */

import type { ExtensionTranslations, TemplateTranslation } from './protocol';

/** Whether the extension's UI shows in the display language (when there is a table for it). */
export const TRANSLATE_EXTENSION_UI_SETTING = 'vilaus.translateExtensionUi';

/** The setting's value: on unless set to false. */
export function translateExtensionUi(settings: Readonly<Record<string, unknown>>): boolean {
  return settings[TRANSLATE_EXTENSION_UI_SETTING] !== false;
}

/** Whitespace runs as single spaces, trimmed: the form texts are keyed and looked up in. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 32-bit FNV-1a over UTF-16 code units, in base 36: quick and synchronous. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}

/** The key of a normalized text: `<length>:<hash>`. */
export function textKey(normalized: string): string {
  return `${normalized.length}:${hash(normalized)}`;
}

/**
 * The key of a template with one variable, from the normalized template's text before and
 * after the variable: `<prefix length>:<suffix length>:<hash>`.
 */
export function templateKey(prefix: string, suffix: string): string {
  return `${prefix.length}:${suffix.length}:${hash(`${prefix}\u0000${suffix}`)}`;
}

/** A variable longer than this is no label's (a mode's one-line description can fill one). */
const MAX_VARIABLE_LENGTH = 100;
const NUMBER = /^\d+(?:[.,]\d+)*$/;

function fits(type: TemplateTranslation['type'], value: string): boolean {
  return value.length > 0 && value.length <= MAX_VARIABLE_LENGTH && (type === 'any' || NUMBER.test(value));
}

/** Looks texts up in a translation table. */
export class ExtensionTranslator {
  private readonly strings: ReadonlyMap<string, string>;
  private readonly templates: ReadonlyMap<string, TemplateTranslation>;
  /** The [prefix, suffix] lengths of the templates, the longest text around the variable first. */
  private readonly shapes: readonly (readonly [number, number])[];
  /** No text longer than this can be in the table. */
  private readonly maxLength: number;

  constructor(table: ExtensionTranslations) {
    this.strings = new Map(Object.entries(table.strings));
    this.templates = new Map(Object.entries(table.templates));
    let maxLength = 0;
    for (const key of this.strings.keys()) {
      maxLength = Math.max(maxLength, Number.parseInt(key, 10) || 0);
    }
    const shapes = new Map<string, readonly [number, number]>();
    for (const key of this.templates.keys()) {
      const [prefix, suffix] = key.split(':').map((part) => Number.parseInt(part, 10));
      if (Number.isInteger(prefix) && Number.isInteger(suffix)) {
        shapes.set(`${prefix}:${suffix}`, [prefix!, suffix!]);
        maxLength = Math.max(maxLength, prefix! + suffix! + MAX_VARIABLE_LENGTH);
      }
    }
    this.shapes = [...shapes.values()].sort((a, b) => b[0] + b[1] - (a[0] + a[1]));
    this.maxLength = maxLength;
  }

  /**
   * The translation of a text as it appears on the page, with its own leading and trailing
   * whitespace kept; undefined when the table has none.
   */
  translate(text: string): string | undefined {
    const normalized = normalizeText(text);
    if (normalized.length === 0 || normalized.length > this.maxLength) {
      return undefined;
    }
    const translation = this.lookup(normalized);
    if (translation === undefined) {
      return undefined;
    }
    const leading = /^\s*/.exec(text)?.[0] ?? '';
    const trailing = /\s*$/.exec(text)?.[0] ?? '';
    return leading + translation + trailing;
  }

  /** An empty translation in the table means "stays English". */
  private lookup(normalized: string): string | undefined {
    const exact = this.strings.get(textKey(normalized));
    if (exact !== undefined) {
      return exact || undefined;
    }
    for (const [prefixLength, suffixLength] of this.shapes) {
      if (prefixLength + suffixLength >= normalized.length) {
        continue;
      }
      const prefix = normalized.slice(0, prefixLength);
      const suffix = normalized.slice(normalized.length - suffixLength);
      const template = this.templates.get(templateKey(prefix, suffix));
      const value = normalized.slice(prefixLength, normalized.length - suffixLength);
      if (template && fits(template.type, value)) {
        // The variable may be UI text itself (`${mode.description}. Click to change…`).
        const shownValue = this.strings.get(textKey(value)) || value;
        return template.text ? template.text.split('{0}').join(shownValue) : undefined;
      }
    }
    return undefined;
  }
}
