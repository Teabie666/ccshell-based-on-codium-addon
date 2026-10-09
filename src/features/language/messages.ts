/** Text of the display language picker and its restart prompt. */

import { defineMessages } from '../../platform/nls';

export const t = defineMessages('language', {
  configureDisplayLanguage: 'Configure Display Language',
  selectDisplayLanguage: 'Select Display Language',
  followSystem: 'Follow System',
  currentSetting: '{0} (current)',
  restartToApply: 'The display language changes to "{0}" after Vilausity restarts.',
  restart: 'Restart',
  languageSetting: 'The display language of Vilausity. Takes effect after a restart.',
  translateExtensionUiSetting:
    "Show the Claude Code extension's own interface (buttons, menus, prompts, the session list) in the display language. Conversations are never translated. Has an effect in Chinese only.",
});
