/** Text of the window commands. */

import { defineMessages } from '../../platform/nls';

export const t = defineMessages('window', {
  closeWindow: 'Close Window',
  quit: 'Exit',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  resetZoom: 'Reset Zoom',
  toggleDevTools: 'Toggle Developer Tools',
  administrator: 'Administrator',
  administratorTooltip:
    'This instance runs as administrator: Claude can change what needs administrator rights. It has windows and state of its own; settings and API providers are shared with the normal instance.',
});
