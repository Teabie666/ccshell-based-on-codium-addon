/** Text of the banner shown when the extension host stops. */

import { defineMessages } from '../../platform/nls';

export const t = defineMessages('extensionHostStatus', {
  stopped: 'Claude Code stopped unexpectedly. {0}',
  restart: 'Restart',
  restartClaudeCode: 'Restart Claude Code',
});
