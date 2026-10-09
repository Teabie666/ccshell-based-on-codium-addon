/** Command palette (Ctrl+Shift+P): every titled, enabled shell command. */

import type { ShellModule } from '../../core/module';
import { ICommands, IDialogs, IKeybindings } from '../../core/serviceIds';
import { t } from './messages';

export const commandPaletteModule: ShellModule = {
  id: 'commandPalette',
  activate({ services, subscriptions, logger }) {
    const commands = services.get(ICommands);
    const keybindings = services.get(IKeybindings);
    const dialogs = services.get(IDialogs);

    subscriptions.add(
      commands.register('commandPalette.show', async () => {
        const available = commands
          .list()
          .filter((command) => command.id !== 'commandPalette.show')
          .map((command) => ({
            id: command.id,
            label: command.category ? `${command.category}: ${command.title}` : (command.title ?? command.id),
            keybinding: keybindings.labelFor(command.id),
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        const picked = await dialogs.showQuickPick({
          placeHolder: t('placeholder'),
          canPickMany: false,
          items: available.map((command) => ({ label: command.label, description: command.keybinding })),
        });
        const chosen = picked?.[0] !== undefined ? available[picked[0]] : undefined;
        if (chosen) {
          await commands.execute(chosen.id).catch((error: unknown) => logger.error(`${chosen.id} failed`, error));
        }
      }),
    );
    subscriptions.add(keybindings.register({ key: 'ctrl+shift+p', command: 'commandPalette.show' }));
    subscriptions.add(keybindings.register({ key: 'f1', command: 'commandPalette.show' }));
  },
};
