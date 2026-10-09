/**
 * One sandboxed <iframe> per extension webview. Routes messages both ways:
 * extension -> iframe (queued until the document has loaded, as VS Code does) and
 * iframe -> extension host / shell (validated by the sending window).
 */

import { Emitter, type Event } from '../platform/event';
import type { ILogger } from '../platform/log';
import type {
  FindDirection,
  KeyEventDto,
  ShellToWebviewControl,
  ThemeData,
  WebviewToShellMessage,
} from '../platform/protocol';
import type { ExtensionHostConnection } from './extensionHost';
import { native } from './native';

const SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-pointer-lock',
  'allow-downloads',
  // window.open is allowed only so main's window-open handler can route it to the browser.
  'allow-popups',
].join(' ');

export interface WebviewKeyEvent {
  readonly webviewId: string;
  readonly event: KeyEventDto;
}

export interface WebviewInfo {
  readonly webviewId: string;
  /** The panel's viewType or the view's id; VS Code's `webviewId` context key. */
  readonly viewType: string;
}

class WebviewFrame {
  readonly iframe: HTMLIFrameElement;
  private loaded = false;
  private loadedOnce = false;
  private queue: unknown[] = [];
  private origin = '*';

  constructor(
    readonly webviewId: string,
    readonly viewType: string,
    container: HTMLElement,
    title: string,
    private readonly onLoad: () => void,
  ) {
    this.iframe = document.createElement('iframe');
    this.iframe.className = 'webview-frame';
    this.iframe.title = title;
    this.iframe.setAttribute('sandbox', SANDBOX);
    this.iframe.setAttribute('allow', 'clipboard-read; clipboard-write; autoplay');
    this.iframe.addEventListener('load', () => {
      if (!this.iframe.src) {
        return;
      }
      this.loaded = true;
      this.loadedOnce = true;
      const pending = this.queue;
      this.queue = [];
      for (const message of pending) {
        this.deliver(message);
      }
      this.onLoad();
    });
    container.appendChild(this.iframe);
  }

  get contentWindow(): Window | null {
    return this.iframe.contentWindow;
  }

  load(url: string): void {
    this.loaded = false;
    if (this.loadedOnce) {
      // Messages meant for the previous document are dropped, like VS Code does.
      this.queue = [];
    }
    this.origin = new URL(url).origin;
    this.iframe.src = url;
  }

  post(message: unknown): void {
    if (this.loaded) {
      this.deliver(message);
    } else {
      this.queue.push(message);
    }
  }

  focus(): void {
    this.iframe.contentWindow?.focus();
  }

  dispose(): void {
    this.queue = [];
    this.iframe.remove();
  }

  private deliver(message: unknown): void {
    this.iframe.contentWindow?.postMessage(message, this.origin === 'null' ? '*' : this.origin);
  }
}

export class WebviewFrames {
  private readonly frames = new Map<string, WebviewFrame>();
  private readonly keyEmitter = new Emitter<WebviewKeyEvent>();
  readonly onDidKeyDown: Event<WebviewKeyEvent> = this.keyEmitter.event;
  private readonly focusEmitter = new Emitter<{ webviewId: string; focused: boolean }>();
  readonly onDidChangeFocus = this.focusEmitter.event;
  private readonly findEmitter = new Emitter<{ webviewId: string; matches: number; active: number }>();
  /** Answers to find: match count and the 1-based active match (0 when none). */
  readonly onDidFindResult = this.findEmitter.event;
  private readonly createEmitter = new Emitter<WebviewInfo>();
  readonly onDidCreate: Event<WebviewInfo> = this.createEmitter.event;
  private readonly disposeEmitter = new Emitter<WebviewInfo>();
  readonly onDidDispose: Event<WebviewInfo> = this.disposeEmitter.event;

  constructor(
    private readonly connection: ExtensionHostConnection,
    private readonly logger: ILogger,
  ) {
    window.addEventListener('message', (event) => this.onWindowMessage(event));
  }

  create(webviewId: string, viewType: string, container: HTMLElement, title: string): void {
    if (this.frames.has(webviewId)) {
      this.logger.warn(`webview ${webviewId} created twice`);
      return;
    }
    const frame = new WebviewFrame(webviewId, viewType, container, title, () => {
      this.connection.rpc?.notify('webview.didLoad', { webviewId });
    });
    this.frames.set(webviewId, frame);
    this.createEmitter.fire({ webviewId, viewType });
  }

  get all(): WebviewInfo[] {
    return [...this.frames.values()].map(({ webviewId, viewType }) => ({ webviewId, viewType }));
  }

  viewTypeOf(webviewId: string): string | undefined {
    return this.frames.get(webviewId)?.viewType;
  }

  load(webviewId: string, url: string): void {
    this.get(webviewId)?.load(url);
  }

  post(webviewId: string, message: unknown): void {
    this.get(webviewId)?.post(message);
  }

  focus(webviewId: string): void {
    this.get(webviewId)?.focus();
  }

  dispose(webviewId: string): void {
    const frame = this.frames.get(webviewId);
    if (!frame) {
      return;
    }
    frame.dispose();
    this.frames.delete(webviewId);
    this.disposeEmitter.fire({ webviewId, viewType: frame.viewType });
  }

  /** The extension host went away: every webview it owned is dead. */
  disposeAll(): void {
    for (const webviewId of [...this.frames.keys()]) {
      this.dispose(webviewId);
    }
  }

  has(webviewId: string): boolean {
    return this.frames.has(webviewId);
  }

  /** Searches inside one webview; the answer arrives on onDidFindResult. */
  find(webviewId: string, text: string, matchCase: boolean, direction: FindDirection): void {
    const control: ShellToWebviewControl = { ccwControl: 'find', text, matchCase, direction };
    this.get(webviewId)?.post(control);
  }

  stopFind(webviewId: string): void {
    const control: ShellToWebviewControl = { ccwControl: 'findStop' };
    this.frames.get(webviewId)?.post(control);
  }

  setTheme(theme: ThemeData): void {
    const control: ShellToWebviewControl = { ccwControl: 'theme', theme };
    for (const frame of this.frames.values()) {
      frame.post(control);
    }
  }

  private get(webviewId: string): WebviewFrame | undefined {
    const frame = this.frames.get(webviewId);
    if (!frame) {
      this.logger.warn(`unknown webview ${webviewId}`);
    }
    return frame;
  }

  private onWindowMessage(event: MessageEvent): void {
    if (!event.source || event.source === window) {
      return;
    }
    const frame = [...this.frames.values()].find((f) => f.contentWindow === event.source);
    if (!frame) {
      return;
    }
    const data = event.data as Partial<WebviewToShellMessage> | null;
    if (!data || data.ccw !== frame.webviewId) {
      return;
    }
    const webviewId = frame.webviewId;
    switch (data.kind) {
      case 'message':
        this.connection.rpc?.notify('webview.didReceiveMessage', { webviewId, message: data.message });
        break;
      case 'state':
        this.connection.rpc?.notify('webview.didUpdateState', { webviewId, state: data.state });
        break;
      case 'link':
        if (typeof data.href === 'string') {
          void native.call('os.openExternal', { url: data.href });
        }
        break;
      case 'keydown':
        if (data.event) {
          this.keyEmitter.fire({ webviewId, event: data.event });
        }
        break;
      case 'findResult':
        this.findEmitter.fire({ webviewId, matches: data.matches ?? 0, active: data.active ?? 0 });
        break;
      case 'focus':
      case 'blur':
        this.focusEmitter.fire({ webviewId, focused: data.kind === 'focus' });
        break;
      default:
        this.logger.warn(`unknown message kind from webview ${webviewId}`);
    }
  }
}
