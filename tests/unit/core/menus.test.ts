import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ContextKeyService } from '../../../src/core/contextKeys';
import { MenuService, type MenuItem } from '../../../src/core/menus';
import { NullLogger } from '../../../src/platform/log';

function titles(groups: MenuItem[][]): string[][] {
  return groups.map((group) => group.map((item) => item.title));
}

describe('MenuService', () => {
  test('orders like VS Code: navigation first, groups by name, no group last; then order, then title', () => {
    const menus = new MenuService(new ContextKeyService(), NullLogger);
    menus.register('m', { command: 'a', title: 'Zeta' });
    menus.register('m', { command: 'b', title: 'Alpha' });
    menus.register('m', { command: 'c', title: 'Copy', group: '9_cutcopypaste' });
    menus.register('m', { command: 'd', title: 'Back', group: 'navigation', order: 2 });
    menus.register('m', { command: 'e', title: 'Open', group: 'navigation', order: 1 });
    menus.register('m', { command: 'f', title: 'Inspect', group: '1_debug' });
    assert.deepEqual(titles(menus.getGroups('m')), [['Open', 'Back'], ['Inspect'], ['Copy'], ['Alpha', 'Zeta']]);
  });

  test('an empty group name counts as no group', () => {
    const menus = new MenuService(new ContextKeyService(), NullLogger);
    menus.register('m', { command: 'a', title: 'B', group: '' });
    menus.register('m', { command: 'b', title: 'A' });
    assert.deepEqual(titles(menus.getGroups('m')), [['A', 'B']]);
  });

  test('when clauses read the overlay first, then the context keys', () => {
    const keys = new ContextKeyService();
    keys.set('webviewId', 'somethingElse');
    keys.set('loggedIn', true);
    const menus = new MenuService(keys, NullLogger);
    menus.register('m', { command: 'a', title: 'Panel only', when: "webviewId == 'claudeVSCodePanel'" });
    menus.register('m', { command: 'b', title: 'Logged in', when: 'loggedIn' });
    assert.deepEqual(titles(menus.getGroups('m', { webviewId: 'claudeVSCodePanel' })), [['Logged in', 'Panel only']]);
    assert.deepEqual(titles(menus.getGroups('m', { webviewId: 'claudeVSCodeSessionsList' })), [['Logged in']]);
    assert.deepEqual(titles(menus.getGroups('m')), [['Logged in']]);
  });

  test('an overlay key set to undefined still hides the context key', () => {
    const keys = new ContextKeyService();
    keys.set('flag', true);
    const menus = new MenuService(keys, NullLogger);
    menus.register('m', { command: 'a', title: 'Flagged', when: 'flag' });
    assert.deepEqual(menus.getGroups('m', { flag: undefined }), []);
  });

  test('an item whose when clause does not parse is hidden, not fatal', () => {
    const menus = new MenuService(new ContextKeyService(), NullLogger);
    menus.register('m', { command: 'a', title: 'Broken', when: 'a ==' });
    menus.register('m', { command: 'b', title: 'Fine' });
    assert.deepEqual(titles(menus.getGroups('m')), [['Fine']]);
  });

  test('register and dispose fire onDidChange with the menu id; disposing twice is harmless', () => {
    const menus = new MenuService(new ContextKeyService(), NullLogger);
    const changes: string[] = [];
    menus.onDidChange((id) => changes.push(id));
    const registration = menus.register('m', { command: 'a', title: 'A' });
    menus.register('other', { command: 'b', title: 'B' });
    registration.dispose();
    registration.dispose();
    assert.deepEqual(changes, ['m', 'other', 'm']);
    assert.deepEqual(menus.getGroups('m'), []);
    assert.deepEqual(titles(menus.getGroups('other')), [['B']]);
  });

  test('a menu nobody contributed to is empty', () => {
    assert.deepEqual(new MenuService(new ContextKeyService(), NullLogger).getGroups('nothing'), []);
  });
});
