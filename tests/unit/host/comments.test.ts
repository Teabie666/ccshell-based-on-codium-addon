import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CommentStore, displayPath, formatComments, sanitizeComments } from '../../../src/host/exthost/comments';
import type { CommentDto } from '../../../src/platform/protocol';

function comment(id: string, overrides: Partial<CommentDto> = {}): CommentDto {
  return {
    id,
    quote: `quote ${id}`,
    uri: `file:///C:/work/proj/${id}.ts`,
    path: `C:\\work\\proj\\${id}.ts`,
    text: `note ${id}`,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    ...overrides,
  };
}

function track(store: CommentStore): string[] {
  const changed: string[] = [];
  store.onDidChange((webviewId) => {
    changed.push(webviewId);
  });
  return changed;
}

describe('CommentStore', () => {
  test('add keeps one comment per id', () => {
    const store = new CommentStore();
    store.add('w1', comment('c1'));
    store.add('w1', comment('c1'));
    assert.deepEqual(store.list('w1').map((c) => c.id), ['c1']);
  });

  test('update fires a change only when the text actually differs', () => {
    const store = new CommentStore();
    store.add('w1', comment('c1', { text: 'old' }));
    const changed = track(store);
    store.update('w1', 'c1', 'old');
    assert.deepEqual(changed, []);
    store.update('w1', 'c1', 'new');
    assert.deepEqual(changed, ['w1']);
    assert.equal(store.list('w1')[0]!.text, 'new');
  });

  test('remove drops the listed ids and fires only when something was removed', () => {
    const store = new CommentStore();
    store.add('w1', comment('c1'));
    store.add('w1', comment('c2'));
    const changed = track(store);
    store.remove('w1', ['c2']);
    assert.deepEqual(changed, ['w1']);
    assert.deepEqual(store.list('w1').map((c) => c.id), ['c1']);
    store.remove('w1', ['c2']);
    assert.deepEqual(changed, ['w1']);
  });

  test("set replaces a conversation's comments and clears them when given an empty list", () => {
    const store = new CommentStore();
    store.add('w1', comment('c1'));
    const changed = track(store);
    store.set('w1', [comment('c2'), comment('c3')]);
    assert.deepEqual(changed, ['w1']);
    assert.deepEqual(store.list('w1').map((c) => c.id), ['c2', 'c3']);
    store.set('w1', []);
    assert.deepEqual(changed, ['w1', 'w1']);
    assert.deepEqual(store.list('w1'), []);
  });

  test('take returns the comments and empties the webview', () => {
    const store = new CommentStore();
    store.add('w1', comment('c1'));
    store.add('w1', comment('c2'));
    assert.deepEqual(store.take('w1').map((c) => c.id), ['c1', 'c2']);
    assert.deepEqual(store.list('w1'), []);
  });

  test('retain drops the comments of webviews that are gone', () => {
    const store = new CommentStore();
    store.add('w1', comment('c1'));
    store.add('w2', comment('c2'));
    store.retain(new Set(['w1']));
    assert.deepEqual(store.list('w1').map((c) => c.id), ['c1']);
    assert.deepEqual(store.list('w2'), []);
  });

  test('list returns an empty array for an unknown webview', () => {
    assert.deepEqual(new CommentStore().list('missing'), []);
  });

  test('onDidChange does not fire when nothing changed', () => {
    const store = new CommentStore();
    const changed = track(store);
    store.set('w1', []);
    store.update('w1', 'c1', 'new');
    store.remove('w1', ['c1']);
    assert.deepEqual(changed, []);
  });
});

describe('sanitizeComments', () => {
  test('returns an empty array for a non-array value', () => {
    assert.deepEqual(sanitizeComments(undefined), []);
    assert.deepEqual(sanitizeComments('x'), []);
    assert.deepEqual(sanitizeComments({}), []);
    assert.deepEqual(sanitizeComments(null), []);
  });

  test('drops malformed entries and keeps the well-formed ones', () => {
    const good = comment('c1');
    assert.deepEqual(sanitizeComments([good, 42, null, 'x', { id: 'c2' }]), [good]);
  });
});

describe('displayPath', () => {
  test('shows a path inside the workspace relative to it, with slash separators', () => {
    assert.equal(displayPath('C:\\work\\proj\\src\\a.ts', ['C:\\work\\proj']), 'src/a.ts');
  });

  test('keeps a path outside the workspace unchanged', () => {
    assert.equal(displayPath('C:\\other\\b.ts', ['C:\\work\\proj']), 'C:\\other\\b.ts');
  });

  test('uses the workspace folder that contains the file', () => {
    assert.equal(displayPath('C:\\work\\proj\\sub\\c.ts', ['C:\\work\\proj\\other', 'C:\\work\\proj\\sub']), 'c.ts');
  });

  test('keeps the file as-is when it is the workspace folder itself', () => {
    assert.equal(displayPath('C:\\work\\proj', ['C:\\work\\proj']), 'C:\\work\\proj');
  });
});

describe('formatComments', () => {
  test('builds the header and one trimmed paragraph per comment, quotes flattened', () => {
    const comments = [
      comment('c1', {
        quote: 'first\n line',
        path: 'C:\\work\\proj\\src\\a.ts',
        text: '  use a Map  ',
        range: { start: { line: 11, character: 0 }, end: { line: 11, character: 9 } },
      }),
      comment('c2', {
        quote: 'second',
        path: 'C:\\work\\proj\\src\\b.ts',
        text: 'note',
        range: { start: { line: 11, character: 2 }, end: { line: 14, character: 5 } },
      }),
    ];
    assert.equal(
      formatComments(comments, ['C:\\work\\proj']),
      'Comments on selected text:\n\n' +
        '[Re: "first line" — src/a.ts:12] use a Map\n\n' +
        '[Re: "second" — src/b.ts:12-15] note',
    );
  });

  test('cuts a quote longer than 200 characters to 200 with an ellipsis', () => {
    const c = comment('c1', { quote: 'x'.repeat(250) });
    assert.equal(
      formatComments([c], ['C:\\work\\proj']),
      `Comments on selected text:\n\n[Re: "${'x'.repeat(199)}…" — c1.ts:1] note c1`,
    );
  });
});
