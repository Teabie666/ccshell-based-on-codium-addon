/** Comment helpers shared by the renderer (labels) and the extension host (messages). */

import type { CommentDto, RangeDto } from './protocol';

/**
 * The 1-based first and last line of a range. A selection that ends at the very start of a
 * line (whole lines selected) stops on the line before, as VS Code counts selected lines.
 */
export function lineSpan(range: RangeDto): { readonly start: number; readonly end: number } {
  const start = range.start.line + 1;
  const end = range.end.line > range.start.line && range.end.character === 0 ? range.end.line : range.end.line + 1;
  return { start, end: Math.max(start, end) };
}

/** `12` or `12-15`. */
export function linesLabel(range: RangeDto): string {
  const { start, end } = lineSpan(range);
  return start === end ? String(start) : `${start}-${end}`;
}

/** Whitespace runs (line breaks too) as single spaces; longer than `limit` ends in `…`. */
export function flattenQuote(quote: string, limit: number): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

function isPosition(value: unknown): value is { line: number; character: number } {
  const position = value as { line?: unknown; character?: unknown } | null;
  return (
    typeof position === 'object' &&
    position !== null &&
    Number.isInteger(position.line) &&
    Number.isInteger(position.character) &&
    (position.line as number) >= 0 &&
    (position.character as number) >= 0
  );
}

/** Whether `value` is a well-formed comment (they cross processes and come back from storage). */
export function isComment(value: unknown): value is CommentDto {
  const comment = value as Partial<Record<keyof CommentDto, unknown>> | null;
  if (typeof comment !== 'object' || comment === null) {
    return false;
  }
  const range = comment.range as { start?: unknown; end?: unknown } | null;
  return (
    typeof comment.id === 'string' &&
    typeof comment.quote === 'string' &&
    typeof comment.uri === 'string' &&
    typeof comment.path === 'string' &&
    typeof comment.text === 'string' &&
    typeof range === 'object' &&
    range !== null &&
    isPosition(range.start) &&
    isPosition(range.end)
  );
}
