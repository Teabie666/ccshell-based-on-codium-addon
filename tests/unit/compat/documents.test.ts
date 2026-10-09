import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TextDocumentImpl } from '../../../src/compat/vscode/textDocuments';
import { Uri } from '../../../src/compat/vscode/uri';
import { panelAreaFor } from '../../../src/compat/vscode/webviews';
import { languageIdFor } from '../../../src/platform/languages';
import type { TextChangeDto } from '../../../src/platform/protocol';

function change(startLine: number, startChar: number, endLine: number, endChar: number, text: string): TextChangeDto {
  return {
    range: { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } },
    rangeOffset: 0,
    rangeLength: 0,
    text,
  };
}

function document(text: string): TextDocumentImpl {
  return new TextDocumentImpl(Uri.file('/tmp/a.txt'), text, 'plaintext', () => Promise.resolve(true));
}

describe('TextDocumentImpl.applyChanges (the editor mirror)', () => {
  test('applies the changes of one event in order', () => {
    const doc = document('one\ntwo\nthree\n');
    // As an editor reports a multi-cursor edit: later positions first.
    doc.applyChanges([change(2, 0, 2, 5, 'THREE'), change(0, 0, 0, 3, 'ONE')]);
    assert.equal(doc.getText(), 'ONE\ntwo\nTHREE\n');
    assert.equal(doc.lineCount, 4);
    assert.equal(doc.version, 2);
  });

  test('keeps CRLF line ends: a line end position sits before the \\r', () => {
    const doc = document('a\r\nb\r\n');
    doc.applyChanges([change(0, 1, 0, 1, '!')]);
    assert.equal(doc.getText(), 'a!\r\nb\r\n');
    doc.applyChanges([change(1, 1, 1, 1, '\r\nc')]);
    assert.equal(doc.getText(), 'a!\r\nb\r\nc\r\n');
    assert.equal(doc.lineAt(2).text, 'c');
  });

  test('a deletion across lines', () => {
    const doc = document('keep\ndrop\nkeep too');
    doc.applyChanges([change(0, 4, 1, 4, '')]);
    assert.equal(doc.getText(), 'keep\nkeep too');
  });
});

describe('panelAreaFor', () => {
  test('the chat panel always goes to the conversation area', () => {
    assert.equal(panelAreaFor('claudeVSCodePanel', { viewColumn: 2 as never }), 'main');
  });

  test('other panels beside the first column go to the content pane', () => {
    assert.equal(panelAreaFor('claudePlanPreview', { viewColumn: 2 as never, preserveFocus: true }), 'side');
    assert.equal(panelAreaFor('claudePlanPreview', -2 as never), 'side');
    assert.equal(panelAreaFor('claudePlanPreview', 1 as never), 'main');
    assert.equal(panelAreaFor('other', undefined), 'main');
  });
});

describe('languageIdFor', () => {
  test('by extension, by whole name, and plaintext when unknown', () => {
    assert.equal(languageIdFor('C:\\x\\Component.tsx'), 'typescriptreact');
    assert.equal(languageIdFor('/x/Dockerfile'), 'dockerfile');
    assert.equal(languageIdFor('.gitignore'), 'ignore');
    assert.equal(languageIdFor('notes.MD'), 'markdown');
    assert.equal(languageIdFor('LICENSE'), 'plaintext');
  });
});
