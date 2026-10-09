/**
 * What the compatibility layer needs from its environment. The extension host implements
 * this on top of RPC (host/exthost/compatHost.ts); tests can implement it in memory.
 * Nothing in compat/ talks to Electron, ports or the renderer directly.
 */

import type { Event } from '../../platform/event';
import type { ILogger } from '../../platform/log';
import type {
  AppInfo,
  ExtHostPaths,
  InputBoxRequest,
  MessageRequest,
  PanelCreateParams,
  PanelUpdateParams,
  QuickPickRequest,
  RangeDto,
  RevealType,
  SelectionDto,
  ShowDiffEditorParams,
  ShowTextEditorParams,
  StorageScope,
  TextChangeDto,
  TextEditDto,
  ThemeKind,
  ViewCreateParams,
  ViewUpdateParams,
  WebviewDocument,
} from '../../platform/protocol';

export interface ExtensionInfo {
  /** `publisher.name`, e.g. `anthropic.claude-code`. */
  readonly id: string;
  readonly path: string;
  readonly packageJson: Readonly<Record<string, unknown>>;
}

export interface OutputSink {
  readonly filePath: string;
  append(text: string): void;
  dispose(): void;
}

export interface SettingsBackend {
  /** Flat `section.key -> value` map, kept current by the host. */
  readonly values: Readonly<Record<string, unknown>>;
  update(key: string, value: unknown): Promise<void>;
  readonly onDidChange: Event<{ readonly keys: readonly string[] }>;
}

export interface StorageBackend {
  initial(scope: StorageScope): Readonly<Record<string, unknown>>;
  set(scope: StorageScope, key: string, value: unknown): void;
}

export interface OsBackend {
  openExternal(url: string): Promise<boolean>;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
}

export interface UiBackend {
  showMessage(request: MessageRequest): Promise<number | undefined>;
  showQuickPick(request: QuickPickRequest): Promise<number[] | undefined>;
  showInputBox(request: InputBoxRequest): Promise<string | undefined>;
}

export interface WebviewBackend {
  setDocument(document: WebviewDocument): Promise<void>;
  releaseDocument(webviewId: string): void;
  load(webviewId: string, url: string): void;
  postMessage(webviewId: string, message: unknown): void;
  createPanel(params: PanelCreateParams): void;
  updatePanel(params: PanelUpdateParams): void;
  revealPanel(panelId: string, preserveFocus: boolean): void;
  disposePanel(panelId: string): void;
  createView(params: ViewCreateParams): void;
  updateView(params: ViewUpdateParams): void;
  revealView(viewId: string, preserveFocus: boolean): void;
  disposeView(viewId: string): void;
  readonly onDidChangeViewVisibility: Event<{ readonly viewId: string; readonly visible: boolean }>;
  readonly onDidReceiveMessage: Event<{ readonly webviewId: string; readonly message: unknown }>;
  readonly onDidUpdateState: Event<{ readonly webviewId: string; readonly state: unknown }>;
  readonly onDidChangePanelViewState: Event<{
    readonly panelId: string;
    readonly active: boolean;
    readonly visible: boolean;
  }>;
  readonly onDidClosePanel: Event<{ readonly panelId: string }>;
}

/** The renderer's side of attached documents (shown in an editor, owned by its text model). */
export interface DocumentsBackend {
  applyEdits(uri: string, edits: readonly TextEditDto[]): Promise<boolean>;
  /** Replace the text with what is on disk and mark it saved. */
  reload(uri: string, text: string): void;
  didSave(uri: string): void;
  /** Changed on disk while it has unsaved changes. */
  didChangeOnDisk(uri: string): void;
  readonly onDidChange: Event<{
    readonly uri: string;
    readonly changes: readonly TextChangeDto[];
    readonly isUndoing: boolean;
    readonly isRedoing: boolean;
  }>;
  readonly onDidChangeDirty: Event<{ readonly uri: string; readonly isDirty: boolean }>;
}

/** The content pane's text and diff editors. */
export interface EditorsBackend {
  showText(params: ShowTextEditorParams): Promise<void>;
  showDiff(params: ShowDiffEditorParams): Promise<void>;
  setSelections(editorId: string, selections: readonly SelectionDto[]): void;
  revealRange(editorId: string, range: RangeDto, revealType: RevealType): void;
  closeTab(tabId: string): void;
  readonly onDidChangeSelection: Event<{ readonly editorId: string; readonly selections: readonly SelectionDto[] }>;
  readonly onDidChangeVisible: Event<{ readonly active: string | undefined; readonly visible: readonly string[] }>;
  readonly onDidActivateTab: Event<{ readonly tabId: string }>;
  readonly onDidCloseTab: Event<{ readonly tabId: string }>;
}

export interface CompatHost {
  readonly logger: ILogger;
  readonly app: AppInfo;
  readonly paths: ExtHostPaths;
  readonly extension: ExtensionInfo;
  readonly workspaceFolders: readonly string[];
  readonly themeKind: ThemeKind;
  readonly settings: SettingsBackend;
  readonly storage: StorageBackend;
  readonly os: OsBackend;
  readonly ui: UiBackend;
  readonly webviews: WebviewBackend;
  readonly documents: DocumentsBackend;
  readonly editors: EditorsBackend;
  /** Records a VS Code API member the extension touched that we do not implement. */
  reportUnimplemented(member: string): void;
  createOutputSink(name: string): OutputSink;
}
