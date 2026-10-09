/**
 * Built-in VS Code workbench commands the extension calls, as vilaus understands them.
 * vilaus has one editor group and no explorer, so most layout commands are deliberate
 * no-ops; registering them keeps shim-unimplemented.log about real gaps only.
 */

import type { CommandRegistry } from '../../compat/vscode/commands';

/** Layout commands that have no meaning with a single editor group. */
const LAYOUT_NO_OPS = [
  'workbench.action.lockEditorGroup',
  'workbench.action.unlockEditorGroup',
  'workbench.action.newGroupRight',
  'workbench.action.newGroupBelow',
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusActiveEditorGroup',
  'workbench.action.closeEditorsInGroup',
  'workbench.action.pinEditor',
  'workbench.action.keepEditor',
  // There is no file explorer in vilaus.
  'revealInExplorer',
  'workbench.files.action.focusFilesExplorer',
];

export function registerWorkbenchCommands(commands: CommandRegistry): void {
  for (const id of LAYOUT_NO_OPS) {
    commands.registerBuiltin(id, () => undefined);
  }
}
