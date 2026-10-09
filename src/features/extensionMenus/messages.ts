/**
 * How the extension's commands are named in the shell's menus. The extension does not
 * localize its manifest (anthropic.claude-code 2.1.282 ships no package.nls files), so the
 * shell names them: the manifest title without its "Claude Code: " prefix (every item in
 * these menus comes from Claude Code anyway), translated by command id when the language
 * pack has it.
 */

import { defineNames } from '../../platform/nls';

/** The commands in the menus the shell shows, as their English names read. */
const commandName = defineNames('extensionCommands', {
  'claude-vscode.markSessionUnread': 'Mark Session as Unread',
  'claude-vscode.renameSessionTab': 'Rename Session Tab',
  'claude-vscode.addSessionTabToGroup': 'Add Session Tab to Group',
});

const MANIFEST_PREFIX = /^Claude Code:\s*/;

export function displayTitle(command: string, manifestTitle: string): string {
  return commandName(command, manifestTitle.replace(MANIFEST_PREFIX, ''));
}
