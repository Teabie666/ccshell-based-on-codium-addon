import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readContributions } from '../../../src/host/exthost/contributions';

describe('readContributions', () => {
  test('reads command titles and menu items, skipping malformed entries', () => {
    const result = readContributions({
      contributes: {
        commands: [
          { command: 'ext.rename', title: 'Ext: Rename', category: 'Ext' },
          { command: 'ext.plain', title: 'Plain' },
          { command: 'ext.noTitle' },
          'not an object',
          null,
        ],
        menus: {
          'webview/context': [
            { command: 'ext.rename', when: "webviewId == 'panel'", group: 'navigation@1' },
            { submenu: 'ext.submenu', group: 'navigation' },
            { command: 42 },
          ],
          commandPalette: [{ command: 'ext.rename', when: 'false' }],
          notAnArray: 'oops',
        },
      },
    });
    assert.deepEqual(result.commands, [
      { command: 'ext.rename', title: 'Ext: Rename', category: 'Ext' },
      { command: 'ext.plain', title: 'Plain', category: undefined },
    ]);
    assert.deepEqual(result.menus['webview/context'], [
      { command: 'ext.rename', when: "webviewId == 'panel'", group: 'navigation@1' },
    ]);
    assert.deepEqual(result.menus.commandPalette, [{ command: 'ext.rename', when: 'false', group: undefined }]);
    assert.deepEqual(result.menus.notAnArray, []);
  });

  test('a manifest without usable contributes has no commands and no menus', () => {
    assert.deepEqual(readContributions({}), { commands: [], menus: {} });
    assert.deepEqual(readContributions({ contributes: [] }), { commands: [], menus: {} });
    assert.deepEqual(readContributions({ contributes: { commands: {}, menus: [] } }), { commands: [], menus: {} });
  });
});
