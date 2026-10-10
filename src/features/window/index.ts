/** Window-level features: title, closing and quitting, zoom, developer tools. */

import type { ShellModule } from '../../core/module';
import { CommandCategory } from '../../core/messages';
import { ICommands, IKeybindings, ILayout, INative, IWorkspace } from '../../core/serviceIds';
import { t } from './messages';

export const windowModule: ShellModule = {
  id: 'window',
  activate({ services, subscriptions }) {
    const layout = services.get(ILayout);
    const commands = services.get(ICommands);
    const keybindings = services.get(IKeybindings);
    const native = services.get(INative);
    const workspace = services.get(IWorkspace);

    // The folder button next to it comes from the workspace module.
    const brand = document.createElement('div');
    brand.className = 'titlebar-brand';
    const app = document.createElement('span');
    app.className = 'titlebar-app';
    app.textContent = 'Vilausity';
    brand.append(app);
    subscriptions.add(layout.addTitleBarItem('left', brand, 10));
    document.title = `${workspace.name} - Vilausity`;

    const zoom = (delta: number) => () => native.call('window.zoom', { delta });
    [
      commands.register('window.close', () => native.call('window.close', undefined), {
        title: t('closeWindow'),
        category: CommandCategory.view,
      }),
      commands.register('app.quit', () => native.call('app.quit', undefined), {
        title: t('quit'),
        category: CommandCategory.file,
      }),
      commands.register('window.zoomIn', zoom(1), { title: t('zoomIn'), category: CommandCategory.view }),
      commands.register('window.zoomOut', zoom(-1), { title: t('zoomOut'), category: CommandCategory.view }),
      commands.register('window.zoomReset', zoom(0), { title: t('resetZoom'), category: CommandCategory.view }),
      commands.register('window.toggleDevTools', () => native.call('window.toggleDevTools', undefined), {
        title: t('toggleDevTools'),
        category: CommandCategory.developer,
      }),
      keybindings.register({ key: 'ctrl+shift+w', command: 'window.close' }),
      keybindings.register({ key: 'ctrl+=', command: 'window.zoomIn' }),
      keybindings.register({ key: 'ctrl+numpad_add', command: 'window.zoomIn' }),
      keybindings.register({ key: 'ctrl+-', command: 'window.zoomOut' }),
      keybindings.register({ key: 'ctrl+numpad_subtract', command: 'window.zoomOut' }),
      keybindings.register({ key: 'ctrl+0', command: 'window.zoomReset' }),
    ].forEach((disposable) => subscriptions.add(disposable));
  },
};
