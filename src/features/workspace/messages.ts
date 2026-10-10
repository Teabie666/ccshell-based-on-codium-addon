/** Text of the workspace folder: the title bar button and the commands that open folders. */

import { defineMessages } from '../../platform/nls';

export const t = defineMessages('workspace', {
  openFolder: 'Open Folder...',
  openFolderInNewWindow: 'Open Folder in New Window...',
  openRecent: 'Open Recent...',
  newWindow: 'New Window',
  revealFolder: 'Reveal Folder in File Explorer',
  recent: 'recent',
  browse: 'Browse...',
  pickToOpen: 'Select a folder to open (Ctrl+Enter: in a new window)',
  pickForNewWindow: 'Select a folder to open in a new window',
  openElsewhere: 'open in another window',
  folderButtonTitle: '{0}\nOpen another folder',
  replaceTitle: 'Open {0} in this window?',
  replaceDetail: 'The conversations and files open here close. They come back when you open {0} again.',
  open: 'Open',
  openInNewWindow: 'Open in New Window',
  folderMissing: 'The folder {0} does not exist.',
});
