import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ContextKeyService } from '../../../src/core/contextKeys';
import { MenuId, MenuService } from '../../../src/core/menus';
import { contributedMenuItems, splitGroup } from '../../../src/features/extensionMenus/menuItems';
import { displayTitle } from '../../../src/features/extensionMenus/messages';
import { languagePack } from '../../../src/nls/packs';
import { NullLogger } from '../../../src/platform/log';
import { setUiLanguage } from '../../../src/platform/nls';
import type { ExtensionContributions } from '../../../src/platform/protocol';

/** The webview/context menu of anthropic.claude-code 2.1.282, plus one undeclared command. */
const contributions: ExtensionContributions = {
  commands: [
    { command: 'claude-vscode.markSessionUnread', title: 'Claude Code: Mark Session as Unread' },
    { command: 'claude-vscode.renameSessionTab', title: 'Claude Code: Rename Session Tab' },
    { command: 'claude-vscode.addSessionTabToGroup', title: 'Claude Code: Add Session Tab to Group' },
  ],
  menus: {
    'webview/context': [
      { command: 'claude-vscode.markSessionUnread', when: "webviewId == 'claudeVSCodePanel'" },
      { command: 'claude-vscode.renameSessionTab', when: "webviewId == 'claudeVSCodePanel'" },
      { command: 'claude-vscode.addSessionTabToGroup', when: "webviewId == 'claudeVSCodePanel'" },
      { command: 'claude-vscode.notDeclared', when: "webviewId == 'claudeVSCodePanel'" },
    ],
  },
};

describe('contributedMenuItems', () => {
  test('takes titles from contributes.commands, without the prefix, and drops undeclared commands', () => {
    const items = contributedMenuItems(contributions, MenuId.WebviewContext);
    assert.deepEqual(
      items.map((item) => item.title),
      ['Mark Session as Unread', 'Rename Session Tab', 'Add Session Tab to Group'],
    );
    assert.equal(items[0]?.when, "webviewId == 'claudeVSCodePanel'");
  });

  test('names the items in Chinese from the language pack when the UI is Chinese', () => {
    setUiLanguage('zh-cn', languagePack('zh-cn'));
    try {
      assert.deepEqual(
        contributedMenuItems(contributions, MenuId.WebviewContext).map((item) => item.title),
        ['将会话标记为未读', '重命名会话标签页', '将会话标签页添加到分组'],
      );
    } finally {
      setUiLanguage('en');
    }
  });

  test('a menu the extension does not contribute to is empty', () => {
    assert.deepEqual(contributedMenuItems(contributions, 'editor/context'), []);
  });

  test('registered in the menu registry, only the chat panel gets them, sorted by title like VS Code', () => {
    const menus = new MenuService(new ContextKeyService(), NullLogger);
    for (const item of contributedMenuItems(contributions, MenuId.WebviewContext)) {
      menus.register(MenuId.WebviewContext, item);
    }
    const commandsFor = (viewType: string) =>
      menus.getGroups(MenuId.WebviewContext, { webviewId: viewType }).map((group) => group.map((item) => item.command));
    assert.deepEqual(commandsFor('claudeVSCodePanel'), [
      ['claude-vscode.addSessionTabToGroup', 'claude-vscode.markSessionUnread', 'claude-vscode.renameSessionTab'],
    ]);
    assert.deepEqual(commandsFor('claudeVSCodeSessionsList'), []);
  });
});

describe('displayTitle', () => {
  test('English drops the "Claude Code: " prefix and keeps titles without it', () => {
    assert.equal(displayTitle('claude-vscode.renameSessionTab', 'Claude Code: Rename Session Tab'), 'Rename Session Tab');
    assert.equal(displayTitle('other.command', 'Do Something'), 'Do Something');
  });

  test('Chinese uses the pack and falls back to the English name for commands it lacks', () => {
    setUiLanguage('zh-cn', languagePack('zh-cn'));
    try {
      assert.equal(displayTitle('claude-vscode.renameSessionTab', 'Claude Code: Rename Session Tab'), '重命名会话标签页');
      assert.equal(displayTitle('claude-vscode.newThing', 'Claude Code: New Thing'), 'New Thing');
    } finally {
      setUiLanguage('en');
    }
  });
});

describe('splitGroup', () => {
  test('splits group@order the way VS Code does', () => {
    assert.deepEqual(splitGroup('navigation@2'), { group: 'navigation', order: 2 });
    assert.deepEqual(splitGroup('a@b@3'), { group: 'a@b', order: 3 });
    assert.deepEqual(splitGroup('1_modify@x'), { group: '1_modify', order: undefined });
    assert.deepEqual(splitGroup('@3'), { group: '@3' });
    assert.deepEqual(splitGroup('plain'), { group: 'plain' });
    assert.deepEqual(splitGroup(''), {});
    assert.deepEqual(splitGroup(undefined), {});
  });
});
