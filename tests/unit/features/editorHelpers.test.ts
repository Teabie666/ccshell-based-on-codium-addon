import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { colorIdForVariable, toHexColor } from '../../../src/features/editor/colors';
import { minimalReplacement } from '../../../src/features/editor/textModels';
import { shortDiffTitle } from '../../../src/features/editor/titles';
import { scorePath } from '../../../src/features/quickOpen/fuzzy';

describe('shortDiffTitle', () => {
  test('replaces a document path with spaces, whatever its case and separators', () => {
    const path = 'c:\\Users\\me\\Made by Claude (Code)\\proj\\a.txt';
    assert.equal(shortDiffTitle('✻ [Claude Code] C:\\Users\\me\\Made by Claude (Code)\\proj\\a.txt', [path]), '✻ [Claude Code] a.txt');
    assert.equal(shortDiffTitle('✻ [Claude Code] /c:/Users/me/Made by Claude (Code)/proj/a.txt', [path]), '✻ [Claude Code] a.txt');
  });

  test('shortens other absolute paths without spaces, keeps plain titles', () => {
    assert.equal(shortDiffTitle('x c:\\a\\b.txt → c:\\a\\c.txt', []), 'x b.txt → c.txt');
    assert.equal(shortDiffTitle('sample.ts (on disk) ↔ sample.ts', ['c:\\w\\sample.ts']), 'sample.ts (on disk) ↔ sample.ts');
  });
});

describe('scorePath', () => {
  test('needs the typed characters in order', () => {
    assert.equal(scorePath('src/features/editor/index.ts', 'xyz'), undefined);
    assert.notEqual(scorePath('src/features/editor/index.ts', 'feidx'), undefined);
  });

  test('a match in the file name beats one spread over folders', () => {
    const inName = scorePath('src/conversationTabs.ts', 'ctab')!;
    const inFolders = scorePath('src/core/tabs/a.ts', 'ctab')!;
    assert.ok(inName > inFolders);
  });

  test('consecutive and word-start characters score more', () => {
    assert.ok(scorePath('lib/textModels.ts', 'tm')! > scorePath('lib/atom.ts', 'tm')!);
    assert.ok(scorePath('a/editor.ts', 'edit')! > scorePath('a/e_d_i_t.ts', 'edit')!);
  });
});

describe('theme colors for Monaco', () => {
  test('toHexColor accepts hex and rgb[a], rejects the rest', () => {
    assert.equal(toHexColor('#ABC'), '#aabbcc');
    assert.equal(toHexColor('#1f1f1f'), '#1f1f1f');
    assert.equal(toHexColor('rgba(255, 0, 0, 0.5)'), '#ff000080');
    assert.equal(toHexColor('rgb(1, 2, 3)'), '#010203');
    assert.equal(toHexColor('rgba(1, 2, 3, 1)'), '#010203');
    assert.equal(toHexColor('13px'), undefined);
    assert.equal(toHexColor('"liga" off'), undefined);
  });

  test('colorIdForVariable turns a CSS variable back into a color id', () => {
    assert.equal(colorIdForVariable('vscode-editor-background'), 'editor.background');
    assert.equal(colorIdForVariable('vscode-editorLineNumber-activeForeground'), 'editorLineNumber.activeForeground');
    assert.equal(colorIdForVariable('editor-background'), undefined);
  });
});

describe('minimalReplacement', () => {
  test('keeps the common prefix and suffix', () => {
    assert.deepEqual(minimalReplacement('abcXYZdef', 'abc12def'), { start: 3, end: 6, text: '12' });
    assert.deepEqual(minimalReplacement('same', 'same'), { start: 4, end: 4, text: '' });
    assert.deepEqual(minimalReplacement('log\n', 'log\nmore\n'), { start: 4, end: 4, text: 'more\n' });
  });
});
