/** Color theme picker. The choice is saved as `ccshell.theme` in settings.json. */

import type { ShellModule } from '../../core/module';
import { CommandCategory } from '../../core/messages';
import { ICommands, IDialogs, IThemes } from '../../core/serviceIds';
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
  },
};
