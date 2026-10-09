import { defineMessages } from '../../platform/nls';

export const t = defineMessages('settings', {
  settingsTitle: 'Settings',
  openSettings: 'Open Settings',
  openSettingsJson: 'Open User Settings (JSON)',
  openSettingsTooltip: 'Settings (Ctrl+,)',
  searchPlaceholder: 'Search settings',
  sections: 'Sections',
  settingsFound: '{0} Settings Found',
  noSettingsFound: 'No Settings Found',
  openJson: 'Open Settings (JSON)',
  editInJson: 'Edit in settings.json',
  resetSetting: 'Reset Setting',
  deprecated: 'Deprecated',
  notNumber: 'Value must be a number.',
  notInteger: 'Value must be an integer.',
  tooSmall: 'Value must be greater than or equal to {0}.',
  tooLarge: 'Value must be less than or equal to {0}.',
  cannotOpenJson: 'Cannot open settings.json.',
  defaultSettingsTitle: 'Default Settings',
  openDefaultSettings: 'Open Default Settings (JSON)',
  defaultSettingsButton: 'Default Settings (JSON)',
  defaultSettingsHeader:
    'Every setting with its default value. Read only: to change one, copy it into settings.json (Open Settings (JSON)).\nsettings.json keeps only what you change, so new defaults still reach you after updates.',
});
