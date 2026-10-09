/**
 * `vscode.TextDocument` and the open-document registry behind `workspace.openTextDocument`,
 * `textDocuments` and the document events. M0 keeps documents as plain text snapshots;
 * M2 binds them to Monaco models in the content pane.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { CancellationToken } from '../../platform/cancellation';
import { Emitter, type Event } from '../../platform/event';
import type { FileSystemService } from './fileSystem';
import { EndOfLine, Position, Range } from './types';
import { Uri } from './uri';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.md': 'markdown',
  '.py': 'python',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cs': 'csharp',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.xml': 'xml',
  '.ps1': 'powershell',
  '.sh': 'shellscript',
  '.bat': 'bat',
  '.cmd': 'bat',
  '.toml': 'toml',
  '.sql': 'sql',
  '.ipynb': 'jupyter',
  '.txt': 'plaintext',
};

export function languageIdFor(fileName: string): string {
  return LANGUAGE_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? 'plaintext';
}

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

export interface DocumentChange {
  readonly document: TextDocumentImpl;
  readonly previousText: string;
}

export class TextDocuments {
  private readonly documents = new Map<string, TextDocumentImpl>();
  private readonly openEmitter = new Emitter<TextDocumentImpl>();
  private readonly closeEmitter = new Emitter<TextDocumentImpl>();
  private readonly changeEmitter = new Emitter<DocumentChange>();
  private readonly saveEmitter = new Emitter<TextDocumentImpl>();
  readonly onDidOpen: Event<TextDocumentImpl> = this.openEmitter.event;
  readonly onDidClose: Event<TextDocumentImpl> = this.closeEmitter.event;
  readonly onDidChange: Event<DocumentChange> = this.changeEmitter.event;
  readonly onDidSave: Event<TextDocumentImpl> = this.saveEmitter.event;
  private untitledCounter = 1;

  constructor(private readonly fileSystem: FileSystemService) {}

  get all(): readonly TextDocumentImpl[] {
    return [...this.documents.values()];
  }

  get(uri: vscode.Uri): TextDocumentImpl | undefined {
    return this.documents.get(uri.toString());
  }

  async open(uri: vscode.Uri): Promise<TextDocumentImpl> {
    const key = uri.toString();
    const existing = this.documents.get(key);
    if (existing && (existing.isDirty || existing.isUntitled)) {
      return existing;
    }
    const text = await this.readText(uri);
    if (existing) {
      // Keep clean documents in sync with disk; Claude edits files behind our back.
      const previousText = existing.getText();
      if (existing.setText(text, false)) {
        this.changeEmitter.fire({ document: existing, previousText });
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

  /** Applies text edits in memory and on disk (file documents). */
  async applyTextEdits(uri: vscode.Uri, edits: readonly { range: vscode.Range; newText: string }[]): Promise<boolean> {
    const document = await this.open(uri);
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
      this.changeEmitter.fire({ document, previousText });
    }
    return true;
  }

  close(uri: vscode.Uri): void {
    const document = this.documents.get(uri.toString());
    if (!document) {
      return;
    }
    document.isClosed = true;
    this.documents.delete(uri.toString());
    this.closeEmitter.fire(document);
  }

  private async save(document: TextDocumentImpl): Promise<boolean> {
    if (document.uri.scheme === 'file') {
      await fs.promises.writeFile(document.uri.fsPath, document.getText(), 'utf8');
    } else if (this.fileSystem.hasProvider(document.uri.scheme)) {
      await this.fileSystem.writeFile(document.uri, new TextEncoder().encode(document.getText()));
    } else {
      return false;
    }
    document.isDirty = false;
    this.saveEmitter.fire(document);
    return true;
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
}
