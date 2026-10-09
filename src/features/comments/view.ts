/** What a conversation's comment blocks show (pure: the module and its tests use it). */

import { flattenQuote, linesLabel } from '../../platform/comments';
import type { CommentDto, CommentsViewDto, RangeDto } from '../../platform/protocol';
import { t } from './messages';

/** More comments than this start folded into "N comments". */
export const COLLAPSE_ABOVE = 3;

/** Quotes in blocks and in the comment form are cut here (the extension's plan comments cut at 120). */
export const QUOTE_LIMIT = 120;

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** `sample.ts:12` or `sample.ts:12-15`. */
export function sourceLabel(path: string, range: RangeDto): string {
  return `${basename(path)}:${linesLabel(range)}`;
}

export function commentsView(comments: readonly CommentDto[]): CommentsViewDto | null {
  if (comments.length === 0) {
    return null;
  }
  return {
    // Newest on top: new blocks stack up from the input.
    blocks: [...comments].reverse().map((comment) => ({
      id: comment.id,
      quote: flattenQuote(comment.quote, QUOTE_LIMIT),
      source: sourceLabel(comment.path, comment.range),
      sourceTitle: t('goTo', `${comment.path}:${linesLabel(comment.range)}`),
      text: comment.text,
    })),
    collapsed: comments.length > COLLAPSE_ABOVE,
    labels: {
      header: comments.length === 1 ? t('oneComment') : t('manyComments', comments.length),
      hint: t('sentWithNextMessage'),
      edit: t('editComment'),
      remove: t('deleteComment'),
      clear: t('clearAll'),
      expand: t('showComments'),
      collapse: t('hideComments'),
    },
  };
}
