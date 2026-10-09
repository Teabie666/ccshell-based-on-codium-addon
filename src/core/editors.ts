/**
 * The editor contribution point: which editor shows a given input in the content pane.
 *
 * An input describes what to show (a text document, a diff, a webview panel, a log...);
 * modules register editors that claim inputs by type, URI scheme or language. The content
 * pane asks the registry for the best editor when it opens a tab.
 */

import type { Event } from '../platform/event';
import type { IDisposable } from '../platform/lifecycle';

export interface EditorInput {
  /** Identity: opening an input whose id is already open activates that tab. */
  readonly id: string;
  /** What kind of thing it is, e.g. `text`, `diff`, `webview`. */
  readonly typeId: string;
  readonly label: string;
  /** Shown dimmed after the label, e.g. the folder of a file. */
  readonly description?: string;
  readonly tooltip?: string;
  /** For document inputs: the URI (as `vscode.Uri.toString()`) and language. */
  readonly resource?: string;
  readonly languageId?: string;
  /** Whatever the opening module needs to hand to its editor. */
  readonly data?: unknown;
}

/** What the content pane offers an editor for the tab it lives in. */
export interface EditorHost {
  setDirty(dirty: boolean): void;
  /** A preview tab becomes a normal tab (e.g. once it is edited). */
  pin(): void;
  close(): void;
  /** The editor took focus; the pane makes its tab the active one. */
  activate(): void;
}

export interface EditorPane extends IDisposable {
  /** The tab became the visible one, or the pane was resized. */
  layout(): void;
  setVisible(visible: boolean): void;
  focus(): void;
  /** Returns false to keep the tab open (e.g. the user cancelled saving changes). */
  confirmClose?(): Promise<boolean>;
  /** Ids of the text editors this pane shows, the input-taking one first (for `visibleTextEditors`). */
  readonly textEditorIds?: readonly string[];
  readonly onDidChangeTextEditors?: Event<void>;
}

export interface EditorProvider {
  readonly id: string;
  /** Among the providers that accept an input, the highest priority wins (default 0). */
  readonly priority?: number;
  accepts(input: EditorInput): boolean;
  create(container: HTMLElement, input: EditorInput, host: EditorHost): EditorPane;
}

export class EditorRegistry {
  private readonly providers: EditorProvider[] = [];

  register(provider: EditorProvider): IDisposable {
    this.providers.push(provider);
    return {
      dispose: () => {
        const index = this.providers.indexOf(provider);
        if (index >= 0) {
          this.providers.splice(index, 1);
        }
      },
    };
  }

  resolve(input: EditorInput): EditorProvider | undefined {
    let best: EditorProvider | undefined;
    for (const provider of this.providers) {
      if (provider.accepts(input) && (!best || (provider.priority ?? 0) > (best.priority ?? 0))) {
        best = provider;
      }
    }
    return best;
  }
}
