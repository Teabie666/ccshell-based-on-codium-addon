import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { webviewDocumentUrl, webviewIdFromUrl } from '../../../src/platform/webviewUrls';

describe('webviewIdFromUrl', () => {
  test('finds the id in webview document URLs', () => {
    assert.equal(webviewIdFromUrl(webviewDocumentUrl('wv1f', 2)), 'wv1f');
    assert.equal(webviewIdFromUrl('ccw://wv0a3/'), 'wv0a3');
    assert.equal(webviewIdFromUrl('ccw://wv0a3?x=1#top'), 'wv0a3');
    assert.equal(webviewIdFromUrl('ccw://wv0a3'), 'wv0a3');
  });

  test('returns undefined for anything else', () => {
    for (const url of [
      'ccw://app/index.html',
      'ccw://res/C%3A/x.js',
      'ccw://wvXYZ/index.html',
      'ccw://wv/index.html',
      'ccw://',
      'https://wv1f/index.html',
      'about:blank',
      '',
    ]) {
      assert.equal(webviewIdFromUrl(url), undefined, url);
    }
  });
});
