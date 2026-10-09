/**
 * Find in the active conversation (Ctrl+F), drawn like VS Code's find widget. The search
 * itself runs inside the conversation's webview (host/webview/find.ts).
 */

import type { IDisposable } from '../../platform/lifecycle';
import type { FindDirection } from '../../platform/protocol';
import type { WebviewFrames } from '../../core/webviewFrames';
import { t } from './messages';

export class FindWidget implements IDisposable {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly caseToggle: HTMLButtonElement;
  private readonly subscription: IDisposable;
  private matchCase = false;
  /** The webview the current search runs in. */
  private target: string | undefined;

  constructor(
    host: HTMLElement,
    private readonly frames: WebviewFrames,
    private readonly activeWebview: () => string | undefined,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'find-widget';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', t('find'));

    this.input = document.createElement('input');
    this.input.className = 'find-input';
    this.input.placeholder = t('find');
    this.input.setAttribute('aria-label', t('find'));
    this.caseToggle = this.button('icon-case', t('matchCase'), () => {
      this.matchCase = !this.matchCase;
      this.caseToggle.classList.toggle('checked', this.matchCase);
      this.search('restart');
    });
    this.count = document.createElement('span');
    this.count.className = 'find-count';
    this.count.textContent = t('noResults');
    const previous = this.button('icon-arrow-up', t('previousMatch'), () => this.search('previous'));
    const next = this.button('icon-arrow-down', t('nextMatch'), () => this.search('next'));
    const close = this.button('icon-close', t('closeFind'), () => this.hide());
    this.root.append(this.input, this.caseToggle, this.count, previous, next, close);
    host.appendChild(this.root);

    this.input.addEventListener('input', () => this.search('restart'));
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.search(event.shiftKey ? 'previous' : 'next');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      } else if (event.altKey && event.code === 'KeyC') {
        event.preventDefault();
        this.caseToggle.click();
      }
    });
    this.subscription = frames.onDidFindResult(({ webviewId, matches, active }) => {
      if (webviewId !== this.target) {
        return;
      }
      this.count.textContent = matches === 0 ? t('noResults') : t('matchPosition', active, matches);
      this.root.classList.toggle('no-results', matches === 0 && this.input.value.length > 0);
    });
  }

  show(): void {
    this.root.hidden = false;
    this.input.focus();
    this.input.select();
    this.search('restart');
  }

  hide(): void {
    if (this.root.hidden) {
      return;
    }
    this.root.hidden = true;
    this.stopTarget();
  }

  /** The active conversation changed: a running search follows it. */
  retarget(): void {
    if (!this.root.hidden) {
      this.search('restart');
    }
  }

  dispose(): void {
    this.stopTarget();
    this.subscription.dispose();
    this.root.remove();
  }

  private search(direction: FindDirection): void {
    const webviewId = this.activeWebview();
    if (webviewId !== this.target) {
      this.stopTarget();
      this.target = webviewId;
    }
    if (!webviewId) {
      this.count.textContent = t('noResults');
      return;
    }
    this.frames.find(webviewId, this.input.value, this.matchCase, direction);
  }

  private stopTarget(): void {
    if (this.target) {
      this.frames.stopFind(this.target);
    }
  }

  private button(iconClass: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `icon-button ${iconClass}`;
    button.title = title;
    button.setAttribute('aria-label', title);
    // Keep focus in the input so typing continues after clicking a button.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', onClick);
    return button;
  }
}
