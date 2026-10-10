/** Text the main process shows: native context menus and error dialogs. */

import { defineMessages } from '../../platform/nls';

export const t = defineMessages('main', {
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
  openLink: 'Open Link in Browser',
  copyLink: 'Copy Link Address',
  extensionNotFound:
    'The Claude Code extension was not found. Install it in VSCodium, or pass --extension-dir <folder>.',
  extensionFailedToStart: 'Claude Code failed to start',
  rollBackOffer: 'Claude Code {0} has not worked here before. Go back to {1}, the version used before it?',
  rollBackAndRestart: 'Go Back to {0} and Restart',
  close: 'Close',
  installVsixTitle: 'Install Claude Code from a VSIX File',
  vsixFiles: 'VSIX Packages',
  extensionHostExited: 'Exit code {0}. Logs: {1}',
});
