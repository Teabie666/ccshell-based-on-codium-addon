import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkPack,
  defineMessages,
  defineNames,
  format,
  getUiLanguage,
  htmlLang,
  parseLanguageSetting,
  resolveUiLanguage,
  setUiLanguage,
} from '../../../src/platform/nls';

describe('format', () => {
  test('fills numbered placeholders, repeated ones too', () => {
    assert.equal(format('{0} of {1}', [2, 5]), '2 of 5');
    assert.equal(format('{0}, {0}!', ['hi']), 'hi, hi!');
    assert.equal(format('第 {0} 项，共 {1} 项', [1, 3]), '第 1 项，共 3 项');
  });

  test('leaves a placeholder without an argument as it is', () => {
    assert.equal(format('{0} and {1}', ['a']), 'a and {1}');
    assert.equal(format('no placeholders', ['x']), 'no placeholders');
  });
});

describe('defineMessages', () => {
  afterEach(() => setUiLanguage('en'));

  const t = defineMessages('test.greetings', { hello: 'Hello, {0}', bye: 'Bye' });
  const pack = { 'test.greetings.hello': '你好，{0}', 'test.greetings.bye': '' };

  test('shows English when the language is English, whatever the pack holds', () => {
    setUiLanguage('en', pack);
    assert.equal(getUiLanguage(), 'en');
    assert.equal(t('hello', 'Ada'), 'Hello, Ada');
  });

  test('looks translations up in the pack as namespace.key', () => {
    setUiLanguage('zh-cn', pack);
    assert.equal(getUiLanguage(), 'zh-cn');
    assert.equal(t('hello', 'Ada'), '你好，Ada');
  });

  test('a missing or empty translation falls back to English', () => {
    setUiLanguage('zh-cn', pack);
    assert.equal(t('bye'), 'Bye');
    setUiLanguage('zh-cn', {});
    assert.equal(t('hello', 'Ada'), 'Hello, Ada');
  });

  test('a namespace can be defined only once', () => {
    assert.throws(() => defineMessages('test.greetings', { other: 'Other' }), /defined twice/);
  });
});

describe('defineNames', () => {
  afterEach(() => setUiLanguage('en'));

  const name = defineNames('test.names', { dark: 'Dark' });

  test('translates the listed ids and keeps the caller text for everything else', () => {
    setUiLanguage('zh-cn', { 'test.names.dark': '深色' });
    assert.equal(name('dark', 'Dark (captured)'), '深色');
    assert.equal(name('new-theme', 'New Theme'), 'New Theme');
    setUiLanguage('en', { 'test.names.dark': '深色' });
    assert.equal(name('dark', 'Dark (captured)'), 'Dark (captured)');
  });
});

describe('checkPack', () => {
  test('reports untranslated strings with their English text, and entries nothing uses', () => {
    // This file defines the namespaces test.greetings and test.names.
    const { missing, stale } = checkPack({ 'test.greetings.hello': '你好，{0}', 'test.gone.key': '旧' });
    assert.deepEqual(missing, { 'test.greetings.bye': 'Bye', 'test.names.dark': 'Dark' });
    assert.deepEqual(stale, ['test.gone.key']);
  });
});

describe('language setting', () => {
  test('parseLanguageSetting accepts the two languages in any case and turns the rest into auto', () => {
    assert.equal(parseLanguageSetting('zh-CN'), 'zh-cn');
    assert.equal(parseLanguageSetting(' en '), 'en');
    assert.equal(parseLanguageSetting('auto'), 'auto');
    assert.equal(parseLanguageSetting('fr'), 'auto');
    assert.equal(parseLanguageSetting(undefined), 'auto');
    assert.equal(parseLanguageSetting(42), 'auto');
  });

  test('an explicit setting wins over the system', () => {
    assert.equal(resolveUiLanguage('en', ['zh-CN']), 'en');
    assert.equal(resolveUiLanguage('zh-cn', ['en-US']), 'zh-cn');
  });

  test('auto follows the first preferred system language; any Chinese gets Simplified Chinese', () => {
    assert.equal(resolveUiLanguage(undefined, ['zh-CN', 'en-US']), 'zh-cn');
    assert.equal(resolveUiLanguage('auto', ['zh-TW']), 'zh-cn');
    assert.equal(resolveUiLanguage('auto', ['zh-Hans-CN']), 'zh-cn');
    assert.equal(resolveUiLanguage('auto', ['zh']), 'zh-cn');
    assert.equal(resolveUiLanguage('auto', ['en-AU', 'zh-CN']), 'en');
    assert.equal(resolveUiLanguage('auto', ['zu-ZA']), 'en');
    assert.equal(resolveUiLanguage('auto', []), 'en');
  });

  test('htmlLang gives the document language tag', () => {
    assert.equal(htmlLang('zh-cn'), 'zh-CN');
    assert.equal(htmlLang('en'), 'en');
  });
});
