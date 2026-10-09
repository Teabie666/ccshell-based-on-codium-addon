/**
 * Key chords, shared by main (which intercepts them before the page sees them) and the
 * renderer (which maps them to commands). A chord is a normalized string such as
 * `ctrl+shift+p`: modifiers in the fixed order ctrl, shift, alt, meta, then the key.
 *
 * Keys come from `KeyboardEvent.code` (physical key), so shortcuts do not change with the
 * keyboard layout or with Shift turning `=` into `+`.
 */

const CODE_TO_KEY: Readonly<Record<string, string>> = {
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Tab: 'tab',
  Escape: 'escape',
  Enter: 'enter',
  Space: 'space',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Home: 'home',
  End: 'end',
  NumpadAdd: 'numpad_add',
  NumpadSubtract: 'numpad_subtract',
};

const MODIFIER_ORDER = ['ctrl', 'shift', 'alt', 'meta'] as const;

export interface ChordInput {
  readonly code: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

/** `KeyN` -> `n`, `Digit1` -> `1`, `F5` -> `f5`; undefined for pure modifier keys. */
export function keyFromCode(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  if (/^(Digit|Numpad)[0-9]$/.test(code)) {
    return code.slice(-1);
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code.toLowerCase();
  }
  return CODE_TO_KEY[code];
}

export function chordFromInput(input: ChordInput): string | undefined {
  const key = keyFromCode(input.code);
  if (!key) {
    return undefined;
  }
  const parts: string[] = [];
  if (input.ctrl) parts.push('ctrl');
  if (input.shift) parts.push('shift');
  if (input.alt) parts.push('alt');
  if (input.meta) parts.push('meta');
  parts.push(key);
  return parts.join('+');
}

/** Normalizes a human-written chord (`Ctrl+Shift+P`, `shift+ctrl+p`) to canonical form. */
export function normalizeChord(chord: string): string {
  const parts = chord.toLowerCase().split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.filter((part) => !(MODIFIER_ORDER as readonly string[]).includes(part)).pop() ?? '';
  const modifiers = MODIFIER_ORDER.filter((modifier) => parts.includes(modifier));
  return [...modifiers, key].join('+');
}

/** `ctrl+shift+p` -> `Ctrl+Shift+P`, for menus and tooltips. */
export function formatChord(chord: string): string {
  return chord
    .split('+')
    .map((part) => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('+');
}
