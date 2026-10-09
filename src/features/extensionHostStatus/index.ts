/** Shows a banner with a Restart button when the extension host process dies. */

import type { ShellModule } from '../../core/module';
import { CommandCategory } from '../../core/messages';
import { ICommands, IContextKeys, ILayout, INative } from '../../core/serviceIds';
import { t } from './messages';

export const extensionHostStatusModule: ShellModule = {
  id: 'extensionHostStatus',
  activate({ services, subscriptions }) {
    const layout = services.get(ILayout);
    const native = services.get(INative);
    const commands = services.get(ICommands);
    const contextKeys = services.get(IContextKeys);

    const banner = document.createElement('div');
    banner.className = 'banner banner-error';
    banner.setAttribute('role', 'alert');
    banner.hidden = true;
    const message = document.createElement('span');
    message.className = 'banner-message';
    const restart = document.createElement('button');
    restart.className = 'button';
    restart.textContent = t('restart');
    restart.addEventListener('click', () => void commands.execute('extensionHost.restart'));
    banner.append(message, restart);
    layout.main.prepend(banner);

    subscriptions.add(
      native.on('extensionHostState', ({ state, detail }) => {
        banner.hidden = state !== 'crashed';
        message.textContent = t('stopped', detail ?? '');
      }),
    );
    subscriptions.add(
      commands.register(
        'extensionHost.restart',
        async () => {
          banner.hidden = true;
          await native.call('app.restartExtensionHost', undefined);
        },
        { title: t('restartClaudeCode'), category: CommandCategory.developer },
      ),
    );
    contextKeys.set('extensionHost.crashed', false);
  },
};
