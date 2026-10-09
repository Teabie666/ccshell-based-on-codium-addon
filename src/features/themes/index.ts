/** Color theme picker. The choice is saved as `vilaus.theme` in settings.json. */

import type { ShellModule } from '../../core/module';
import { CommandCategory, SettingsSection } from '../../core/messages';
import { ICommands, IDialogs, ISettings, IThemes } from '../../core/serviceIds';
import { DEFAULT_FONTS, DEFAULT_THEME_ID } from '../../platform/defaults';
import { t, themeLabel } from './messages';

export const themesModule: ShellModule = {
  id: 'themes',
  activate({ services, subscriptions }) {
    const commands = services.get(ICommands);
    const dialogs = services.get(IDialogs);
    const themes = services.get(IThemes);

    subscriptions.add(
      commands.register(
        'themes.select',
        async () => {
          const available = await themes.list();
          const current = themes.current.id;
          const picked = await dialogs.showQuickPick({
            title: t('colorTheme'),
            placeHolder: t('selectColorTheme'),
            canPickMany: false,
            items: available.map((theme) => ({
              label: themeLabel(theme.id, theme.label),
              description: theme.id === current ? t('current') : undefined,
            })),
          });
          const chosen = picked?.[0] !== undefined ? available[picked[0]] : undefined;
          if (chosen && chosen.id !== current) {
            await themes.select(chosen.id);
          }
        },
        { title: t('colorTheme'), category: CommandCategory.preferences },
      ),
    );

    // Main applies these (theme, and the UI font through the theme variables).
    const settings = services.get(ISettings);
    const fonts = settings.register([
      {
        key: 'workbench.fontFamily',
        section: SettingsSection.workbench,
        order: 1,
        schema: { type: 'string', default: DEFAULT_FONTS.family, description: t('uiFontFamily') },
      },
      {
        key: 'workbench.fontSize',
        section: SettingsSection.workbench,
        order: 2,
        schema: { type: 'number', default: DEFAULT_FONTS.size, minimum: 6, maximum: 32, description: t('uiFontSize') },
      },
    ]);
    subscriptions.add(fonts);
    void themes.list().then((available) => {
      subscriptions.add(
        settings.register([
          {
            key: 'vilaus.theme',
            section: SettingsSection.workbench,
            order: 0,
            schema: {
              type: 'string',
              default: DEFAULT_THEME_ID,
              enum: available.map((theme) => theme.id),
              enumItemLabels: available.map((theme) => themeLabel(theme.id, theme.label)),
              description: t('themeSetting'),
            },
          },
        ]),
      );
    });
  },
};
