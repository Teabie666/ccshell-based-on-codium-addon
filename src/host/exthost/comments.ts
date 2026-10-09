/**
 * Comments on text selected in the content pane. They belong to a conversation (by the
 * webview of its panel) until the next message the user sends there, which carries them
 * (bridge.ts). The renderer adds, edits and removes them and is told of every change; they
 * survive a restart with their panel (panelRestore.ts).
 */

import * as path from 'node:path';
import { flattenQuote, isComment, linesLabel } from '../../platform/comments';
import { Emitter, type Event } from '../../platform/event';
import type { IDisposable } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import type { CommentDto } from '../../platform/protocol';
import type { RendererRpc } from './compatHost';

/** Opens the block of comments a message carries. */
export const COMMENTS_HEADER = 'Comments on selected text:';

/** A quote in a message is cut here; the file and lines locate the rest. */
const MESSAGE_QUOTE_LIMIT = 200;

export class CommentStore {
  private readonly byWebview = new Map<string, readonly CommentDto[]>();
  private readonly changeEmitter = new Emitter<string>();
  /** Fires the id of the webview whose comments changed. */
  readonly onDidChange: Event<string> = this.changeEmitter.event;

  /** Oldest first. */
  list(webviewId: string): readonly CommentDto[] {
    return this.byWebview.get(webviewId) ?? [];
  }

  add(webviewId: string, comment: CommentDto): void {
    const comments = this.list(webviewId);
    if (comments.some((existing) => existing.id === comment.id)) {
      return;
    }
    this.set(webviewId, [...comments, comment]);
  }

  update(webviewId: string, id: string, text: string): void {
    const comments = this.list(webviewId);
    if (comments.some((comment) => comment.id === id && comment.text !== text)) {
      this.set(
        webviewId,
        comments.map((comment) => (comment.id === id ? { ...comment, text } : comment)),
      );
    }
  }

  remove(webviewId: string, ids: readonly string[]): void {
    const comments = this.list(webviewId);
    const kept = comments.filter((comment) => !ids.includes(comment.id));
    if (kept.length !== comments.length) {
      this.set(webviewId, kept);
    }
  }

  /** Replaces a conversation's comments (e.g. restored after a restart). */
  set(webviewId: string, comments: readonly CommentDto[]): void {
    if (comments.length === 0 && !this.byWebview.has(webviewId)) {
      return;
    }
    if (comments.length === 0) {
      this.byWebview.delete(webviewId);
    } else {
      this.byWebview.set(webviewId, comments);
    }
    this.changeEmitter.fire(webviewId);
  }

  /** Removes a conversation's comments and returns them: a message took them along. */
  take(webviewId: string): readonly CommentDto[] {
    const comments = this.list(webviewId);
    this.set(webviewId, []);
    return comments;
  }

  /** Forgets the comments of conversations that are gone. */
  retain(alive: ReadonlySet<string>): void {
    for (const webviewId of [...this.byWebview.keys()]) {
      if (!alive.has(webviewId)) {
        this.set(webviewId, []);
      }
    }
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** The well-formed comments in a stored value (anything else is dropped). */
export function sanitizeComments(value: unknown): CommentDto[] {
  return Array.isArray(value) ? value.filter(isComment) : [];
}

/** Relative to the workspace folder it is in (with `/` separators), else the whole path. */
export function displayPath(file: string, workspaceFolders: readonly string[]): string {
  for (const folder of workspaceFolders) {
    const relative = path.relative(folder, file);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
  }
  return file;
}

/**
 * The text a message carries for its comments, oldest first, one paragraph each, in the
 * extension's plan-comment style with the place added: `[Re: "<quote>" — <file>:<lines>] <comment>`.
 */
export function formatComments(comments: readonly CommentDto[], workspaceFolders: readonly string[]): string {
  const paragraphs = comments.map((comment) => {
    const quote = flattenQuote(comment.quote, MESSAGE_QUOTE_LIMIT);
    const place = `${displayPath(comment.path, workspaceFolders)}:${linesLabel(comment.range)}`;
    return `[Re: "${quote}" — ${place}] ${comment.text.trim()}`;
  });
  return `${COMMENTS_HEADER}\n\n${paragraphs.join('\n\n')}`;
}

/**
 * Serves the renderer's comment requests and tells it about every change. Requests for a
 * webview that is no conversation (any more) are ignored.
 */
export function registerCommentRequests(
  renderer: RendererRpc,
  store: CommentStore,
  isConversation: (webviewId: string) => boolean,
  logger: ILogger,
): IDisposable {
  renderer.handle('comments.add', ({ webviewId, comment }) => {
    if (!isConversation(webviewId) || !isComment(comment)) {
      logger.warn(`ignored a comment for ${webviewId}`);
      return;
    }
    store.add(webviewId, comment);
  });
  renderer.handle('comments.update', ({ webviewId, id, text }) => store.update(webviewId, id, text));
  renderer.handle('comments.remove', ({ webviewId, ids }) => store.remove(webviewId, ids));
  return store.onDidChange((webviewId) =>
    renderer.notify('comments.didChange', { webviewId, comments: store.list(webviewId) }),
  );
}
