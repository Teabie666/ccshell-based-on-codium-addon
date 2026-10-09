/**
 * An auxiliary window: a blank window this page opens (same origin, run by this page's
 * scripts, like VS Code's auxiliary windows) to show one content pane tab. It mirrors the
 * main page's styles (stylesheets, Monaco's generated styles, the theme variables) and
 * draws a title bar like the main window's.
 */

import { Emitter } from '../../platform/event';
import { DisposableStore, toDisposable, type IDisposable } from '../../platform/lifecycle';
import { AUX_WINDOW_NAME_PREFIX } from '../../platform/protocol';
import { t } from './messages';

export interface AuxWindowBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The CSS of a stylesheet, including rules added through the CSSOM (insertRule). */
function cssTextOf(style: HTMLStyleElement): string {
  try {
    const rules = style.sheet?.cssRules;
    if (rules && rules.length > 0) {
      return Array.from(rules, (rule) => rule.cssText).join('\n');
    }
  } catch {
    // Unreadable sheet: fall back to the element's text.
  }
  return style.textContent ?? '';
}

/**
 * Keeps `target` styled like `source`: clones of its stylesheets and <style> elements (kept
 * up to date), and the attributes the theme sets on <html> and <body>.
 */
function mirrorStyles(source: Document, target: Document): IDisposable & { resync(): void } {
  const clones = new Map<Node, HTMLElement>();
  const cloneNode = (node: Node): void => {
    let clone: HTMLElement | undefined;
    if (node.nodeName === 'STYLE') {
      clone = target.createElement('style');
      clone.textContent = cssTextOf(node as HTMLStyleElement);
    } else if (node.nodeName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet') {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = (node as HTMLLinkElement).href;
      clone = link;
    }
    if (clone) {
      target.head.appendChild(clone);
      clones.set(node, clone);
    }
  };
  source.head.childNodes.forEach(cloneNode);

  const resyncStyle = (node: Node | null): void => {
    const style = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    const clone = style ? clones.get(style) : undefined;
    if (style?.nodeName === 'STYLE' && clone) {
      clone.textContent = cssTextOf(style as HTMLStyleElement);
    }
  };
  const headObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList' && record.target === source.head) {
        record.addedNodes.forEach(cloneNode);
        record.removedNodes.forEach((node) => {
          clones.get(node)?.remove();
          clones.delete(node);
        });
      } else {
        resyncStyle(record.target);
      }
    }
  });
  headObserver.observe(source.head, { childList: true, subtree: true, characterData: true });

  // Theme variables live on <html style>, the theme kind on <body class>.
  const copyRoot = (): void => {
    target.documentElement.setAttribute('style', source.documentElement.getAttribute('style') ?? '');
    target.documentElement.className = source.documentElement.className;
    target.documentElement.lang = source.documentElement.lang;
    target.body.className = `${source.body.className} aux-window`;
  };
  copyRoot();
  const rootObserver = new MutationObserver(copyRoot);
  rootObserver.observe(source.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'lang'] });
  rootObserver.observe(source.body, { attributes: true, attributeFilter: ['class'] });

  return {
    // Rules added with insertRule change no text; picked up when the window is focused.
    resync: () => clones.forEach((_clone, node) => resyncStyle(node)),
    dispose: () => {
      headObserver.disconnect();
      rootObserver.disconnect();
    },
  };
}

export class AuxWindow implements IDisposable {
  readonly body: HTMLElement;
  private readonly label: HTMLElement;
  private readonly disposables = new DisposableStore();
  private closingByUs = false;
  private closed = false;
  private readonly focusEmitter = new Emitter<boolean>();
  readonly onDidChangeFocus = this.focusEmitter.event;
  private readonly closeEmitter = new Emitter<void>();
  /** The window is gone (closed by the user or by close()). */
  readonly onDidClose = this.closeEmitter.event;
  /** Asked when the user closes the window; it only closes on true. */
  onWillClose: (() => Promise<boolean>) | undefined;
  onMoveBack: (() => void) | undefined;

  static open(id: string, title: string, bounds: AuxWindowBounds): AuxWindow | undefined {
    const features = `popup,left=${Math.round(bounds.left)},top=${Math.round(bounds.top)},width=${Math.round(bounds.width)},height=${Math.round(bounds.height)}`;
    const opened = window.open('about:blank', `${AUX_WINDOW_NAME_PREFIX}${id}`, features);
    return opened ? new AuxWindow(opened, title) : undefined;
  }

  private constructor(
    readonly window: Window,
    title: string,
  ) {
    const doc = window.document;
    const styles = mirrorStyles(document, doc);
    this.disposables.add(styles);

    const titleBar = doc.createElement('header');
    titleBar.className = 'titlebar';
    const left = doc.createElement('div');
    left.className = 'titlebar-left';
    this.label = doc.createElement('div');
    this.label.className = 'titlebar-brand aux-title';
    const moveBack = doc.createElement('button');
    moveBack.className = 'icon-button titlebar-button icon-move-back';
    moveBack.title = t('moveBack');
    moveBack.setAttribute('aria-label', t('moveBack'));
    moveBack.addEventListener('click', () => this.onMoveBack?.());
    left.append(moveBack, this.label);
    const spacer = doc.createElement('div');
    spacer.className = 'aux-titlebar-fill';
    const controls = doc.createElement('div');
    controls.className = 'titlebar-controls-space';
    titleBar.append(left, spacer, controls);
    this.body = doc.createElement('div');
    this.body.className = 'aux-body';
    doc.body.append(titleBar, this.body);
    this.setTitle(title);

    const onFocus = (): void => {
      styles.resync();
      this.focusEmitter.fire(true);
    };
    const onBlur = (): void => this.focusEmitter.fire(false);
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (this.closingByUs) {
        return;
      }
      // The user closed the window: the owner decides (unsaved changes...), then closes it.
      event.preventDefault();
      event.returnValue = false;
      void (this.onWillClose?.() ?? Promise.resolve(true)).then((close) => {
        if (close) {
          this.close();
        }
      });
    };
    const onPageHide = (): void => this.markClosed();
    window.addEventListener('focus', onFocus);
    // An element taking focus also means the window has it (the window event can come late).
    doc.addEventListener('focusin', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    this.disposables.add(
      toDisposable(() => {
        window.removeEventListener('focus', onFocus);
        doc.removeEventListener('focusin', onFocus);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('pagehide', onPageHide);
      }),
    );
  }

  get document(): Document {
    return this.window.document;
  }

  get hasFocus(): boolean {
    return !this.closed && this.window.document.hasFocus();
  }

  setTitle(title: string): void {
    this.label.textContent = title;
    this.window.document.title = `${title} - ccshell`;
  }

  setDirty(dirty: boolean): void {
    this.label.classList.toggle('dirty', dirty);
  }

  /** Closes the window without asking. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closingByUs = true;
    this.window.close();
    this.markClosed();
  }

  dispose(): void {
    this.close();
  }

  private markClosed(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.disposables.dispose();
    this.closeEmitter.fire();
    this.closeEmitter.dispose();
    this.focusEmitter.dispose();
  }
}
