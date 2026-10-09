/**
 * Message-level adaptations between the Claude Code webview and its extension.
 *
 * Everything here depends on the extension's PRIVATE webview protocol (verified against
 * anthropic.claude-code 2.1.282). Re-check this file whenever the extension updates.
 *
 *   webview -> extension  { type: 'request', channelId, requestId, request: { type, ... } }
 *                         { type: 'cancel_request', targetRequestId }
 *                         { type: 'io_message', channelId, message, done }   (user input)
 *   extension -> webview  { type: 'from-extension', message: { type: 'response', requestId, response } }
 *
 * Keep this the only place outside compat/ that knows about those shapes, and about the
 * extension's pages (the selectors in the page hints, the state they save).
 */

import { CHAT_PANEL_VIEW_TYPE, type WebviewImpl, type WebviewMessageInterceptor } from '../../compat/vscode/webviews';
import type { OsBackend } from '../../compat/vscode/host';
import type { ILogger } from '../../platform/log';
import type { WebviewPageHints } from '../../platform/protocol';
import { formatComments, type PendingComments } from './comments';

interface WebviewRequest {
  readonly type: 'request';
  readonly channelId?: string;
  readonly requestId: string;
  readonly request: { readonly type: string; readonly [key: string]: unknown };
}

/**
 * The conversation's message input and the form around it (anthropic.claude-code 2.1.282:
 * `form > fieldset > div > div[role=textbox][aria-label="Message input"]`, inside a
 * bottom-anchored container whose height the page measures to keep the last message above
 * it). Comment blocks go right before the form, so the page makes room for them too.
 */
const CHAT_INPUT_FORM = 'form:has([role="textbox"][aria-label="Message input"])';

/**
 * The session a conversation panel's page shows, from the state it saves
 * (anthropic.claude-code 2.1.282: `{ sessionID, sessionWithNoTranscript, ... }`, saved again
 * whenever the page's session changes). A new conversation gets a session id at once, but
 * until its first prompt the page marks it `sessionWithNoTranscript`: such a session is not
 * resumed (a restored panel starts over under a new id), so it does not count yet.
 */
export function conversationSessionId(state: unknown): string | undefined {
  if (!isRecord(state)) {
    return undefined;
  }
  const sessionId = state.sessionID;
  return typeof sessionId === 'string' && sessionId.length > 0 && state.sessionWithNoTranscript !== sessionId
    ? sessionId
    : undefined;
}

export interface BridgeOptions {
  /**
   * Whether vilaus can show diff editors. Until M2 it cannot, and the webview must
   * then not wait on `open_diff`, or it auto-rejects every edit (see below).
   */
  readonly diffEditorAvailable: () => boolean;
  /** Comments waiting for their conversation's next message. */
  readonly comments: PendingComments;
  /** For the paths in comments: relative to the workspace when inside it. */
  readonly workspaceFolders: readonly string[];
}

export class ClaudeWebviewBridge implements WebviewMessageInterceptor {
  /** `open_diff` requests we are holding, by requestId. */
  private readonly heldDiffs = new Map<string, WebviewImpl>();
  private loggedInputShape = false;

  constructor(
    private readonly os: OsBackend,
    private readonly logger: ILogger,
    private readonly options: BridgeOptions,
  ) {}

  interceptFromWebview(webview: WebviewImpl, message: unknown): boolean {
    if (!isRecord(message)) {
      return false;
    }
    if (message.type === 'cancel_request' && typeof message.targetRequestId === 'string') {
      return this.releaseHeldDiff(message.targetRequestId);
    }
    if (message.type === 'io_message') {
      this.logInputShapeOnce(message);
      this.attachComments(webview, message);
      return false;
    }
    if (!isWebviewRequest(message)) {
      return false;
    }
    switch (message.request.type) {
      case 'open_diff':
        return this.holdDiff(webview, message);
      case 'accept_diff':
        return this.answerAcceptDiff(webview, message);
      case 'open_url':
        return this.openUrl(webview, message);
      default:
        return false;
    }
  }

  /**
   * Edit/Write permission flow (anthropic.claude-code 2.1.282): the webview sends
   * `open_diff` and treats an empty answer as "user cancelled the edit". With no diff
   * editor we hold the request; the user decides in the chat's inline prompt, after which
   * the webview cancels the request and we answer it empty, exactly as VS Code does when
   * the diff tab is closed.
   */
  private holdDiff(webview: WebviewImpl, message: WebviewRequest): boolean {
    if (this.options.diffEditorAvailable()) {
      return false;
    }
    this.heldDiffs.set(message.requestId, webview);
    this.logger.debug(`holding open_diff ${message.requestId} (no diff editor)`);
    return true;
  }

  private releaseHeldDiff(requestId: string): boolean {
    const webview = this.heldDiffs.get(requestId);
    if (!webview) {
      return false;
    }
    this.heldDiffs.delete(requestId);
    respond(webview, requestId, { type: 'open_diff_response' });
    return true;
  }

  /**
   * Inline "accept" first asks the extension to accept from the diff tab (`accept_diff`);
   * `found: false` makes the webview fall back to accepting directly.
   */
  private answerAcceptDiff(webview: WebviewImpl, message: WebviewRequest): boolean {
    if (this.options.diffEditorAvailable()) {
      return false;
    }
    respond(webview, message.requestId, { type: 'accept_diff_response', found: false });
    return true;
  }

  /** Opens the exact URL string; going through `Uri.parse` can alter query encoding. */
  private openUrl(webview: WebviewImpl, message: WebviewRequest): boolean {
    const url = message.request.url;
    if (typeof url !== 'string') {
      return false;
    }
    void this.os.openExternal(url).catch((error: unknown) => this.logger.warn(`open_url failed: ${url}`, error));
    respond(webview, message.requestId, { type: 'open_url_response' });
    return true;
  }

  pageHints(webview: WebviewImpl): WebviewPageHints | undefined {
    return webview.viewType === CHAT_PANEL_VIEW_TYPE ? { commentsAnchor: CHAT_INPUT_FORM } : undefined;
  }

  /**
   * A user message takes its conversation's comments along, as one more text block after
   * what the user typed; the typed text itself is left alone. In 2.1.282 an `io_message`
   * carries `{type: "user", message: {role: "user", content: [...]}}`, and the typed text
   * is the last text block (context such as the editor selection comes first). Slash
   * commands (`/compact`...) go out the same way; they leave the comments for the next message.
   */
  private attachComments(webview: WebviewImpl, message: Record<string, unknown>): void {
    const store = this.options.comments;
    if (store.list(webview.id).length === 0) {
      return;
    }
    const user = message.message;
    if (!isRecord(user) || user.type !== 'user' || !isRecord(user.message)) {
      return;
    }
    const inner = user.message;
    const content: unknown[] | undefined =
      typeof inner.content === 'string' ? [{ type: 'text', text: inner.content }] : Array.isArray(inner.content) ? inner.content : undefined;
    if (!content) {
      this.logger.warn(`io_message content is ${describeShape(inner.content)}; comments not attached`);
      return;
    }
    const typed = content.findLast((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string');
    if (isRecord(typed) && String(typed.text).trimStart().startsWith('/')) {
      return;
    }
    const comments = store.take(webview.id);
    inner.content = [...content, { type: 'text', text: formatComments(comments, this.options.workspaceFolders) }];
    this.logger.info(`attached ${comments.length} comment(s) to a message`);
  }

  /** Records the structure (never the content) of the first user message, for the comments feature (M3). */
  private logInputShapeOnce(message: Record<string, unknown>): void {
    if (this.loggedInputShape) {
      return;
    }
    this.loggedInputShape = true;
    this.logger.info(`io_message shape: ${describeShape(message)}`);
  }
}

function respond(webview: WebviewImpl, requestId: string, response: Record<string, unknown>): void {
  void webview.postMessage({ type: 'from-extension', message: { type: 'response', requestId, response } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWebviewRequest(value: Record<string, unknown>): value is Record<string, unknown> & WebviewRequest {
  return (
    value.type === 'request' &&
    typeof value.requestId === 'string' &&
    isRecord(value.request) &&
    typeof value.request.type === 'string'
  );
}

/** Discriminant fields whose values are protocol vocabulary, not user content. */
const LITERAL_KEYS = new Set(['type', 'role']);

/**
 * `{type: "user", message: {content: [...]}}`-style summary with no user content.
 * Arrays are described by their first element only: enough to learn a message format.
 */
export function describeShape(value: unknown, depth = 0): string {
  if (Array.isArray(value)) {
    return depth > 4 ? 'array' : `[${value.length > 0 ? describeShape(value[0], depth + 1) : ''}]`;
  }
  if (isRecord(value)) {
    if (depth > 4) {
      return 'object';
    }
    const fields = Object.entries(value).map(([key, field]) =>
      LITERAL_KEYS.has(key) && typeof field === 'string'
        ? `${key}: ${JSON.stringify(field)}`
        : `${key}: ${describeShape(field, depth + 1)}`,
    );
    return `{${fields.join(', ')}}`;
  }
  return typeof value;
}
