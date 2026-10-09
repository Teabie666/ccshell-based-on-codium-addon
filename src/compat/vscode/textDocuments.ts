/**
 * `vscode.TextDocument` and the open-document registry behind `workspace.openTextDocument`,
 * `textDocuments` and the document events.
 *
 * A document shown in an editor is "attached": the renderer's text model owns its text and
 * this registry mirrors it (`acceptChanges`); edits made here go to the renderer, and come
 * back as changes. Documents nobody shows are edited here directly.
 */

import * as fs from 'node:fs';
import type * as vscode from 'vscode';
import { CancellationToken } from '../../platform/cancellation';
import { Emitter, type Event } from '../../platform/event';
import { languageIdFor } from '../../platform/languages';
import type { IDisposable } from '../../platform/lifecycle';
import type { DocumentSnapshot, TextChangeDto, TextEditDto } from '../../platform/protocol';
import type { FileSystemService } from './fileSystem';
import type { DocumentsBackend } from './host';
import { EndOfLine, Position, Range, TextDocumentChangeReason, TextDocumentSaveReason } from './types';
import { Uri } from './uri';

export { languageIdFor };

/** How long `onWillSaveTextDocument` participants may delay a save, like VS Code. */
const WILL_SAVE_BUDGET_MS = 1500;
/** Disk events arrive in bursts (truncate, then write); read once they settle. */
const WATCH_SETTLE_MS = 100;

export class TextDocumentImpl {
  private text: string;
  private lineStarts: number[] = [];
  version = 1;
  isDirty = false;
  isClosed = false;
  readonly encoding = 'utf8';

  constructor(
    readonly uri: vscode.Uri,
    text: string,
    readonly languageId: string,
    private readonly saveHandler: (document: TextDocumentImpl) => Promise<boolean>,
  ) {
    this.text = text;
    this.index();
  }

  get fileName(): string {
    return this.uri.scheme === 'file' ? this.uri.fsPath : this.uri.path;
  }

  get isUntitled(): boolean {
    return this.uri.scheme === 'untitled';
  }

  get eol(): EndOfLine {
    return this.text.includes('\r\n') ? EndOfLine.CRLF : EndOfLine.LF;
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  getText(range?: vscode.Range): string {
    if (!range) {
      return this.text;
    }
    const r = this.validateRange(range);
    return this.text.slice(this.offsetAt(r.start), this.offsetAt(r.end));
  }

  lineAt(lineOrPosition: number | vscode.Position): vscode.TextLine {
    const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
    if (line < 0 || line >= this.lineCount) {
      throw new Error(`Illegal line ${line}`);
    }
    const start = this.lineStarts[line]!;
    const nextStart = line + 1 < this.lineCount ? this.lineStarts[line + 1]! : this.text.length;
    const raw = this.text.slice(start, nextStart);
    const content = raw.replace(/\r?\n$/, '');
    const firstNonWhitespace = content.search(/\S/);
    const range = new Range(line, 0, line, content.length);
    const isLastLine = line + 1 >= this.lineCount;
    return {
      lineNumber: line,
      text: content,
      range,
      rangeIncludingLineBreak: isLastLine ? range : new Range(line, 0, line + 1, 0),
      firstNonWhitespaceCharacterIndex: firstNonWhitespace === -1 ? content.length : firstNonWhitespace,
      isEmptyOrWhitespace: firstNonWhitespace === -1,
    } as vscode.TextLine;
  }

  offsetAt(position: vscode.Position): number {
    const p = this.validatePosition(position);
    return this.lineStarts[p.line]! + p.character;
  }

  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(Math.floor(offset), this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.lineStarts[mid]! <= clamped) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return new Position(low, clamped - this.lineStarts[low]!);
  }

  validatePosition(position: vscode.Position): Position {
    const line = Math.max(0, Math.min(position.line, this.lineCount - 1));
    const length = this.lineAt(line).text.length;
    return new Position(line, Math.max(0, Math.min(position.character, length)));
  }

  validateRange(range: vscode.Range): Range {
    return new Range(this.validatePosition(range.start), this.validatePosition(range.end));
  }

  getWordRangeAtPosition(position: vscode.Position, regex = /[\w$]+/g): Range | undefined {
    const line = this.lineAt(position.line).text;
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    for (const match of line.matchAll(new RegExp(regex.source, flags))) {
      const start = match.index;
      const end = start + match[0].length;
      if (start <= position.character && position.character <= end) {
        return new Range(position.line, start, position.line, end);
      }
    }
    return undefined;
  }

  save(): Promise<boolean> {
    return this.saveHandler(this);
  }

  /** Replaces the whole text (external reload or an applied edit). Returns true when it changed. */
  setText(text: string, dirty: boolean): boolean {
    if (text === this.text) {
      return false;
    }
    this.text = text;
    this.version++;
    this.isDirty = dirty;
    this.index();
    return true;
  }

  /**
   * Applies the changes of one editor event in order; each range refers to the text as
   * the previous change left it (the renderer sends them that way, like VS Code).
   */
  applyChanges(changes: readonly TextChangeDto[]): void {
    let text = this.text;
    for (const change of changes) {
      const start = offsetIn(text, change.range.start.line, change.range.start.character);
      const end = offsetIn(text, change.range.end.line, change.range.end.character);
      text = text.slice(0, start) + change.text + text.slice(end);
    }
    this.text = text;
    this.version++;
    this.index();
  }

  snapshot(readOnly: boolean): DocumentSnapshot {
    return {
      uri: this.uri.toString(),
      path: this.fileName,
      text: this.text,
      languageId: this.languageId,
      isDirty: this.isDirty,
      readOnly,
    };
  }

  private index(): void {
    const starts = [0];
    for (let i = 0; i < this.text.length; i++) {
      if (this.text.charCodeAt(i) === 10) {
        starts.push(i + 1);
      }
    }
    this.lineStarts = starts;
  }
}

/** Offset of a 0-based line/character in `text`, clamped like `validatePosition`. */
function offsetIn(text: string, line: number, character: number): number {
  let offset = 0;
  for (let current = 0; current < line; current++) {
    const next = text.indexOf('\n', offset);
    if (next < 0) {
      return text.length;
    }
    offset = next + 1;
  }
  const lineEnd = text.indexOf('\n', offset);
  const end = lineEnd < 0 ? text.length : lineEnd > offset && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
  return Math.min(offset + Math.max(0, character), end);
}

export interface DocumentChange {
  readonly document: TextDocumentImpl;
  readonly contentChanges: readonly vscode.TextDocumentContentChangeEvent[];
  readonly reason: TextDocumentChangeReason | undefined;
}

export interface WillSaveEvent {
  readonly document: TextDocumentImpl;
  readonly reason: TextDocumentSaveReason;
  waitUntil(thenable: Thenable<unknown>): void;
}

/** A change that replaces all of `previousText`, for edits applied without a range. */
function wholeTextChange(previousText: string, text: string): vscode.TextDocumentContentChangeEvent {
  const lines = previousText.split('\n');
  const end = lines.length - 1;
  return {
    range: new Range(0, 0, end, lines[end]!.replace(/\r$/, '').length),
    rangeOffset: 0,
    rangeLength: previousText.length,
    text,
  };
}

export class TextDocuments implements IDisposable {
  private readonly documents = new Map<string, TextDocumentImpl>();
  /** Attached documents (shown in an editor), with how many editors show them. */
  private readonly attached = new Map<string, number>();
  private readonly watchers = new Map<string, { watcher: fs.FSWatcher; timer?: ReturnType<typeof setTimeout> }>();
  private readonly openEmitter = new Emitter<TextDocumentImpl>();
  private readonly closeEmitter = new Emitter<TextDocumentImpl>();
  private readonly changeEmitter = new Emitter<DocumentChange>();
  private readonly willSaveEmitter = new Emitter<WillSaveEvent>();
  private readonly saveEmitter = new Emitter<TextDocumentImpl>();
  readonly onDidOpen: Event<TextDocumentImpl> = this.openEmitter.event;
  readonly onDidClose: Event<TextDocumentImpl> = this.closeEmitter.event;
  readonly onDidChange: Event<DocumentChange> = this.changeEmitter.event;
  readonly onWillSave: Event<WillSaveEvent> = this.willSaveEmitter.event;
  readonly onDidSave: Event<TextDocumentImpl> = this.saveEmitter.event;
  private untitledCounter = 1;

  constructor(
    private readonly fileSystem: FileSystemService,
    private readonly backend: DocumentsBackend,
  ) {
    backend.onDidChange(({ uri, changes, isUndoing, isRedoing }) => this.acceptChanges(uri, changes, isUndoing, isRedoing));
    backend.onDidChangeDirty(({ uri, isDirty }) => this.acceptDirty(uri, isDirty));
  }

  get all(): readonly TextDocumentImpl[] {
    return [...this.documents.values()];
  }

  get(uri: vscode.Uri | string): TextDocumentImpl | undefined {
    return this.documents.get(uri.toString());
  }

  isAttached(uri: vscode.Uri | string): boolean {
    return this.attached.has(uri.toString());
  }

  /** Whether the shell may edit the document: files and writable providers, not read-only content. */
  isReadOnly(document: TextDocumentImpl): boolean {
    const scheme = document.uri.scheme;
    return !(scheme === 'file' || scheme === 'untitled' || this.fileSystem.hasProvider(scheme));
  }

  async open(uri: vscode.Uri): Promise<TextDocumentImpl> {
    const key = uri.toString();
    const existing = this.documents.get(key);
    if (existing && (existing.isDirty || existing.isUntitled || this.attached.has(key))) {
      // Attached documents follow the editor; disk changes reach them through the watcher.
      return existing;
    }
    const text = await this.readText(uri);
    if (existing) {
      // Keep clean documents in sync with disk; Claude edits files behind our back.
      const previousText = existing.getText();
      if (existing.setText(text, false)) {
        this.changeEmitter.fire({ document: existing, contentChanges: [wholeTextChange(previousText, text)], reason: undefined });
      }
      return existing;
    }
    const document = new TextDocumentImpl(uri, text, languageIdFor(uri.path), (doc) => this.save(doc));
    this.documents.set(key, document);
    this.openEmitter.fire(document);
    return document;
  }

  openUntitled(content: string, language?: string): TextDocumentImpl {
    const uri = Uri.from({ scheme: 'untitled', path: `Untitled-${this.untitledCounter++}` });
    const document = new TextDocumentImpl(uri, content, language ?? 'plaintext', (doc) => this.save(doc));
    this.documents.set(uri.toString(), document);
    this.openEmitter.fire(document);
    return document;
  }

  /** An editor now shows the document. */
  attach(document: TextDocumentImpl): void {
    const key = document.uri.toString();
    const count = this.attached.get(key) ?? 0;
    this.attached.set(key, count + 1);
    if (count === 0) {
      this.watch(document);
    }
  }

  /**
   * An editor stopped showing the document. When none is left, a file document is closed,
   * as VS Code does when its model goes away; documents of extension-provided schemes (the
   * diff's proposed side) stay open because their owner still holds them.
   */
  detach(document: TextDocumentImpl): void {
    const key = document.uri.toString();
    const count = (this.attached.get(key) ?? 0) - 1;
    if (count > 0) {
      this.attached.set(key, count);
      return;
    }
    this.attached.delete(key);
    this.unwatch(key);
    if (document.uri.scheme === 'file' || document.uri.scheme === 'untitled') {
      this.close(document.uri);
    }
  }

  /** The renderer changed an attached document. */
  acceptChanges(uri: string, changes: readonly TextChangeDto[], isUndoing: boolean, isRedoing: boolean): void {
    const document = this.documents.get(uri);
    if (!document || changes.length === 0) {
      return;
    }
    document.applyChanges(changes);
    this.changeEmitter.fire({
      document,
      contentChanges: changes.map((change) => ({
        range: new Range(change.range.start.line, change.range.start.character, change.range.end.line, change.range.end.character),
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text,
      })),
      reason: isUndoing ? TextDocumentChangeReason.Undo : isRedoing ? TextDocumentChangeReason.Redo : undefined,
    });
  }

  acceptDirty(uri: string, isDirty: boolean): void {
    const document = this.documents.get(uri);
    if (document) {
      document.isDirty = isDirty;
    }
  }

  /** Applies text edits: through the editor when attached, else in memory and on disk (file documents). */
  async applyTextEdits(uri: vscode.Uri, edits: readonly { range: vscode.Range; newText: string }[]): Promise<boolean> {
    const document = await this.open(uri);
    if (this.attached.has(uri.toString())) {
      const dtos: TextEditDto[] = edits.map((edit) => {
        const range = document.validateRange(edit.range);
        return {
          range: {
            start: { line: range.start.line, character: range.start.character },
            end: { line: range.end.line, character: range.end.character },
          },
          text: edit.newText,
        };
      });
      return this.backend.applyEdits(uri.toString(), dtos);
    }
    const previousText = document.getText();
    const sorted = [...edits].sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start));
    let text = previousText;
    for (const edit of sorted) {
      const start = document.offsetAt(edit.range.start);
      const end = document.offsetAt(edit.range.end);
      text = text.slice(0, start) + edit.newText + text.slice(end);
    }
    const persistent = uri.scheme === 'file';
    if (document.setText(text, !persistent)) {
      if (persistent) {
        await fs.promises.writeFile(uri.fsPath, text, 'utf8');
      }
      this.changeEmitter.fire({ document, contentChanges: [wholeTextChange(previousText, text)], reason: undefined });
    }
    return true;
  }

  /** Reads the document again from disk (or its provider), dropping unsaved changes. */
  async revert(uri: string): Promise<void> {
    const document = this.documents.get(uri);
    if (!document) {
      return;
    }
    const text = await this.readText(document.uri);
    if (this.attached.has(uri)) {
      this.backend.reload(uri, text);
      return;
    }
    const previousText = document.getText();
    if (document.setText(text, false)) {
      this.changeEmitter.fire({ document, contentChanges: [wholeTextChange(previousText, text)], reason: undefined });
    }
    document.isDirty = false;
  }

  close(uri: vscode.Uri): void {
    const key = uri.toString();
    const document = this.documents.get(key);
    if (!document) {
      return;
    }
    document.isClosed = true;
    this.documents.delete(key);
    this.attached.delete(key);
    this.unwatch(key);
    this.closeEmitter.fire(document);
  }

  dispose(): void {
    for (const key of [...this.watchers.keys()]) {
      this.unwatch(key);
    }
  }

  private async save(document: TextDocumentImpl): Promise<boolean> {
    const scheme = document.uri.scheme;
    if (scheme !== 'file' && !this.fileSystem.hasProvider(scheme)) {
      return false;
    }
    await this.fireWillSave(document);
    const text = document.getText();
    if (scheme === 'file') {
      // Our own write must not look like an external change, even if the user types on
      // before the watcher reports it.
      this.written.set(document.uri.toString(), text);
      await fs.promises.writeFile(document.uri.fsPath, text, 'utf8');
    } else {
      await this.fileSystem.writeFile(document.uri, new TextEncoder().encode(text));
    }
    document.isDirty = false;
    if (this.attached.has(document.uri.toString())) {
      this.backend.didSave(document.uri.toString());
    }
    this.saveEmitter.fire(document);
    return true;
  }

  private async fireWillSave(document: TextDocumentImpl): Promise<void> {
    const pending: Thenable<unknown>[] = [];
    this.willSaveEmitter.fire({
      document,
      reason: TextDocumentSaveReason.Manual,
      waitUntil: (thenable) => pending.push(thenable),
    });
    if (pending.length > 0) {
      // Participants' edits (TextEdit[] results) are not applied; ccshell has no formatters.
      const budget = new Promise((resolve) => setTimeout(resolve, WILL_SAVE_BUDGET_MS));
      await Promise.race([Promise.allSettled(pending), budget]);
    }
  }

  private async readText(uri: vscode.Uri): Promise<string> {
    if (uri.scheme === 'untitled') {
      return '';
    }
    const contentProvider = this.fileSystem.contentProviderFor(uri.scheme);
    if (contentProvider) {
      return (await contentProvider.provideTextDocumentContent(uri, CancellationToken.None)) ?? '';
    }
    return new TextDecoder().decode(await this.fileSystem.readFile(uri));
  }

  // ---- external changes to attached files -------------------------------------------

  /** The text this registry last wrote to each file. */
  private readonly written = new Map<string, string>();

  private watch(document: TextDocumentImpl): void {
    if (document.uri.scheme !== 'file') {
      return;
    }
    const key = document.uri.toString();
    try {
      const watcher = fs.watch(document.uri.fsPath, { persistent: false }, () => this.scheduleCheck(key));
      watcher.on('error', () => this.unwatch(key));
      this.watchers.set(key, { watcher });
    } catch {
      // The file may not exist yet (a new file Claude proposes); nothing to watch.
    }
  }

  private unwatch(key: string): void {
    const entry = this.watchers.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      entry.watcher.close();
      this.watchers.delete(key);
    }
    this.written.delete(key);
  }

  private scheduleCheck(key: string): void {
    const entry = this.watchers.get(key);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.checkDisk(key), WATCH_SETTLE_MS);
  }

  private async checkDisk(key: string): Promise<void> {
    const document = this.documents.get(key);
    if (!document || !this.attached.has(key)) {
      return;
    }
    let text: string;
    try {
      text = await fs.promises.readFile(document.uri.fsPath, 'utf8');
    } catch {
      return; // Deleted or locked mid-write; the next event will tell.
    }
    if (text === document.getText() || text === this.written.get(key)) {
      return;
    }
    this.written.delete(key);
    if (document.isDirty) {
      this.backend.didChangeOnDisk(key);
    } else {
      this.backend.reload(key, text);
    }
  }
}
