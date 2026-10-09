/**
 * The comment form, like the extension's plan-comment input: the quoted text, a text box,
 * Cancel and Add Comment. Enter adds (Ctrl+Enter too), Shift+Enter starts a new line,
 * Escape cancels. Also edits an existing comment.
 */

import { flattenQuote } from '../../platform/comments';
import { t } from './messages';
import { QUOTE_LIMIT } from './view';

export interface CommentFormOptions {
  readonly quote: string;
  /** Where the quote is from, e.g. `sample.ts:12`. */
  readonly source: string;
  /** The comment being edited; none for a new one. */
  readonly text?: string;
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
}

export class CommentForm {
  readonly element: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly submit: HTMLButtonElement;
  private readonly initial: string;

  constructor(private readonly options: CommentFormOptions) {
    this.initial = options.text ?? '';
    const editing = options.text !== undefined;
    this.element = document.createElement('div');
    this.element.className = 'comment-form';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', editing ? t('editComment') : t('addComment'));

    const quote = document.createElement('div');
    quote.className = 'comment-form-quote';
    const quoteText = document.createElement('span');
    quoteText.className = 'comment-form-quote-text';
    quoteText.textContent = flattenQuote(options.quote, QUOTE_LIMIT);
    const source = document.createElement('span');
    source.className = 'comment-form-source';
    source.textContent = options.source;
    quote.append(quoteText, source);

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'comment-form-input';
    this.textarea.rows = 3;
    this.textarea.placeholder = t('placeholder');
    this.textarea.value = this.initial;
    this.textarea.addEventListener('input', () => this.update());
    this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button secondary';
    cancel.textContent = t('cancel');
    cancel.title = t('cancelTooltip');
    cancel.addEventListener('click', () => options.onCancel());
    this.submit = document.createElement('button');
    this.submit.type = 'button';
    this.submit.className = 'button';
    this.submit.dataset.action = 'submit';
    this.submit.textContent = editing ? t('save') : t('addComment');
    this.submit.title = editing ? t('saveTooltip') : t('addCommentTooltip');
    this.submit.addEventListener('click', () => this.trySubmit());
    const actions = document.createElement('div');
    actions.className = 'comment-form-actions';
    actions.append(cancel, this.submit);

    this.element.append(quote, this.textarea, actions);
    this.update();
  }

  focus(): void {
    this.textarea.focus();
    this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
  }

  /** Whether closing it would lose typing. */
  get isDirty(): boolean {
    return this.textarea.value !== this.initial;
  }

  private update(): void {
    this.submit.disabled = this.textarea.value.trim() === '';
  }

  private trySubmit(): void {
    const text = this.textarea.value.trim();
    if (text !== '') {
      this.options.onSubmit(text);
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Enter while an IME composes a word picks the word.
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      this.trySubmit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.options.onCancel();
    }
  }
}
