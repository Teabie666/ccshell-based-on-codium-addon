/**
 * Syntax highlighting for Monaco with Shiki: VS Code's TextMate grammars and the Dark+ /
 * Light+ token colors, so code looks as it does in VS Code. Grammars load on first use.
 *
 * Editor colors (background, line numbers, selection, widgets) come from the captured
 * shell theme; only token colors come from Dark+ / Light+ (Dark Modern and Light Modern
 * use exactly those; the high-contrast themes fall back to them).
 *
 * The tokenizer follows @shikijs/monaco's technique: tokens carry a TextMate scope that
 * the Monaco theme maps back to the token's color.
 */

import { createHighlighterCore, type HighlighterCore, type ThemeRegistration, type ThemeRegistrationResolved } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';
import { EncodedTokenMetadata, INITIAL, type StateStack } from 'shiki/textmate';
import type { ILogger } from '../../platform/log';
import type { ThemeData } from '../../platform/protocol';
import { colorIdForVariable, toHexColor } from './colors';
import type { MonacoApi } from './monaco';

/** vscode-textmate's FontStyle bits (an ambient const enum there). */
const FontStyle = { None: 0, Italic: 1, Bold: 2, Underline: 4, Strikethrough: 8 } as const;

interface TokenRule {
  readonly token: string;
  readonly foreground?: string;
  readonly background?: string;
  readonly fontStyle?: string;
}

/** VS Code language ids whose grammar has another name in Shiki. */
const GRAMMAR_FOR_LANGUAGE: Readonly<Record<string, string | null>> = {
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  restructuredtext: 'rst',
  'cuda-cpp': 'cpp',
  dockerfile: 'docker',
  makefile: 'make',
  jupyter: 'json',
  plaintext: null,
  ignore: null,
};

const MAX_LINE_LENGTH = 20_000;
const LINE_TIME_LIMIT_MS = 500;

class TokenizerState {
  constructor(readonly stack: StateStack) {}

  clone(): TokenizerState {
    return new TokenizerState(this.stack);
  }

  equals(other: unknown): boolean {
    return other instanceof TokenizerState && other.stack === this.stack;
  }
}

function isLight(theme: ThemeData): boolean {
  return theme.kind === 'vscode-light' || theme.kind === 'vscode-high-contrast-light';
}

function monacoBase(theme: ThemeData): 'vs' | 'vs-dark' | 'hc-black' | 'hc-light' {
  switch (theme.kind) {
    case 'vscode-light':
      return 'vs';
    case 'vscode-high-contrast':
      return 'hc-black';
    case 'vscode-high-contrast-light':
      return 'hc-light';
    default:
      return 'vs-dark';
  }
}

export class Highlighting {
  private highlighter: Promise<HighlighterCore> | undefined;
  private themeName: string | undefined;
  private readonly colorMap: string[] = [];
  private readonly scopeByColorStyle = new Map<string, string>();
  /** Monaco language id -> Shiki grammar name, for languages with a tokens provider. */
  private readonly tokenized = new Map<string, string>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly monaco: MonacoApi,
    private readonly logger: ILogger,
  ) {}

  /** Builds the Monaco theme for `theme`, applies it, and re-tokenizes open models. */
  async setTheme(theme: ThemeData): Promise<void> {
    const highlighter = await this.load();
    const name = `ccshell-${theme.id}`;
    const tokenTheme = (await bundledThemes[isLight(theme) ? 'light-plus' : 'dark-plus']()).default;
    const colors: Record<string, string> = {};
    for (const [id, value] of Object.entries(tokenTheme.colors ?? {})) {
      const hex = toHexColor(value);
      if (hex) {
        colors[id] = hex;
      }
    }
    for (const [variable, value] of Object.entries(theme.variables)) {
      const id = colorIdForVariable(variable);
      const hex = id ? toHexColor(value) : undefined;
      if (id && hex) {
        colors[id] = hex;
      }
    }
    const registration: ThemeRegistration = { ...tokenTheme, name, colors };
    await highlighter.loadTheme(registration);
    const rules = tokenRules(highlighter.getTheme(name));
    this.monaco.editor.defineTheme(name, { base: monacoBase(theme), inherit: false, colors, rules: [...rules] });

    const { colorMap } = highlighter.setTheme(name);
    this.colorMap.splice(0, this.colorMap.length, ...colorMap.map((color) => normalizeColor(color) ?? ''));
    this.scopeByColorStyle.clear();
    for (const rule of rules) {
      const color = normalizeColor(rule.foreground);
      if (color) {
        const key = colorStyleKey(color, rule.fontStyle ?? '');
        if (!this.scopeByColorStyle.has(key)) {
          this.scopeByColorStyle.set(key, rule.token);
        }
      }
    }
    this.themeName = name;
    this.monaco.editor.setTheme(name);
    // Tokens carry scopes picked by color; a new theme needs them picked again.
    for (const [languageId, grammar] of this.tokenized) {
      this.installTokensProvider(languageId, grammar);
    }
  }

  /**
   * Highlights a code block for HTML views (the Markdown preview), in the current theme's
   * token colors. `language` is a fence info string or a language id; unknown ones stay plain.
   */
  async codeToHtml(code: string, language: string): Promise<string | undefined> {
    const grammar = grammarFor(language.toLowerCase());
    if (!grammar || !this.themeName) {
      return undefined;
    }
    await this.ensureLanguage(language.toLowerCase());
    const highlighter = await this.load();
    try {
      return highlighter.codeToHtml(code, { lang: grammar, theme: this.themeName });
    } catch {
      return undefined; // The grammar failed to load; the block stays plain.
    }
  }

  /** Makes sure `languageId` is registered with Monaco and highlighted (loading its grammar once). */
  ensureLanguage(languageId: string): Promise<void> {
    if (!this.monaco.languages.getLanguages().some((language) => language.id === languageId)) {
      this.monaco.languages.register({ id: languageId });
    }
    const grammar = grammarFor(languageId);
    if (!grammar || this.tokenized.has(languageId)) {
      return Promise.resolve();
    }
    let loading = this.pending.get(languageId);
    if (!loading) {
      loading = this.loadGrammar(languageId, grammar).finally(() => this.pending.delete(languageId));
      this.pending.set(languageId, loading);
    }
    return loading;
  }

  private async loadGrammar(languageId: string, grammar: string): Promise<void> {
    try {
      const highlighter = await this.load();
      await highlighter.loadLanguage(bundledLanguages[grammar as keyof typeof bundledLanguages]);
      this.tokenized.set(languageId, grammar);
      this.installTokensProvider(languageId, grammar);
    } catch (error) {
      this.logger.warn(`no highlighting for ${languageId}`, error);
    }
  }

  private load(): Promise<HighlighterCore> {
    this.highlighter ??= createHighlighterCore({
      themes: [],
      langs: [],
      // No WebAssembly: the JS engine covers VS Code's grammars; unsupported patterns are skipped.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
    return this.highlighter;
  }

  private installTokensProvider(languageId: string, grammarName: string): void {
    void this.highlighter?.then((highlighter) => {
      const grammar = highlighter.getLanguage(grammarName);
      this.monaco.languages.setTokensProvider(languageId, {
        getInitialState: () => new TokenizerState(INITIAL),
        tokenize: (line, state) => {
          const current = state as TokenizerState;
          if (line.length >= MAX_LINE_LENGTH || !this.themeName) {
            return { endState: current, tokens: [{ startIndex: 0, scopes: '' }] };
          }
          const result = grammar.tokenizeLine2(line, current.stack, LINE_TIME_LIMIT_MS);
          const tokens: { startIndex: number; scopes: string }[] = [];
          for (let i = 0; i < result.tokens.length; i += 2) {
            const metadata = result.tokens[i + 1]!;
            const color = this.colorMap[EncodedTokenMetadata.getForeground(metadata)];
            const style = fontStyleName(EncodedTokenMetadata.getFontStyle(metadata));
            tokens.push({
              startIndex: result.tokens[i]!,
              scopes: color ? (this.scopeByColorStyle.get(colorStyleKey(color, style)) ?? '') : '',
            });
          }
          return { endState: new TokenizerState(result.ruleStack), tokens };
        },
      });
    });
  }
}

/** Monaco token rules from a TextMate theme's scoped settings. */
function tokenRules(theme: ThemeRegistrationResolved): TokenRule[] {
  const rules: TokenRule[] = [];
  for (const { scope, settings } of theme.settings ?? theme.tokenColors ?? []) {
    const foreground = normalizeColor(settings?.foreground);
    const background = normalizeColor(settings?.background);
    const fontStyle = fontStyleOf(settings?.fontStyle);
    if (!foreground && !background && !fontStyle) {
      continue;
    }
    const scopes = (Array.isArray(scope) ? scope : scope ? [scope] : []).flatMap((s: string) => s.split(','));
    for (const token of scopes.map((s) => s.trim()).filter(Boolean)) {
      rules.push({ token, foreground, background, fontStyle });
    }
  }
  return rules;
}

/** A theme's `fontStyle` setting in the fixed order the tokenizer produces. */
function fontStyleOf(value: string | undefined): string {
  const styles = new Set(
    (value ?? '')
      .toLowerCase()
      .split(/[\s,]+/)
      .map((style) => (style === 'line-through' ? 'strikethrough' : style)),
  );
  return ['italic', 'bold', 'underline', 'strikethrough'].filter((style) => styles.has(style)).join(' ');
}

function grammarFor(languageId: string): string | undefined {
  const mapped = GRAMMAR_FOR_LANGUAGE[languageId];
  if (mapped === null) {
    return undefined;
  }
  const name = mapped ?? languageId;
  return name in bundledLanguages ? name : undefined;
}

function normalizeColor(color: string | undefined): string | undefined {
  if (!color) {
    return undefined;
  }
  return toHexColor(color.startsWith('#') ? color : `#${color}`)?.slice(1);
}

function fontStyleName(bits: number): string {
  if (bits <= FontStyle.None) {
    return '';
  }
  const styles: string[] = [];
  if (bits & FontStyle.Italic) styles.push('italic');
  if (bits & FontStyle.Bold) styles.push('bold');
  if (bits & FontStyle.Underline) styles.push('underline');
  if (bits & FontStyle.Strikethrough) styles.push('strikethrough');
  return styles.join(' ');
}

function colorStyleKey(color: string, fontStyle: string): string {
  return fontStyle ? `${color}|${fontStyle}` : color;
}
