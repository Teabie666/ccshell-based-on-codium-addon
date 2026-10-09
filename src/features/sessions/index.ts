/**
 * The session list: the Claude Code extension's own session-list webview view, shown in
 * the sidebar in place of a file tree. Clicking a session asks the extension to open it,
 * which arrives as a conversation panel.
 */

import type { ShellModule } from '../../core/module';
import { CommandCategory } from '../../core/messages';
import { ICommands, IExtensionHost, IKeybindings, ILayout, IWebviewFrames } from '../../core/serviceIds';
import { t } from './messages';

/** View id registered by anthropic.claude-code 2.1.282 (package.json `views`). */
const SESSION_LIST_VIEW = 'claudeVSCodeSessionsList';

export const sessionsModule: ShellModule = {
  id: 'sessions',
  activate({ services, subscriptions, logger }) {
    const layout = services.get(ILayout);
    const commands = services.get(ICommands);
    const keybindings = services.get(IKeybindings);
    const connection = services.get(IExtensionHost);
    const frames = services.get(IWebviewFrames);

    const container = document.createElement('div');
    container.className = 'sidebar-view';
    const placeholder = document.createElement('div');
    placeholder.className = 'sidebar-placeholder';
    placeholder.textContent = t('loading');
    container.appendChild(placeholder);
    layout.sidebar.appendChild(container);

    let view: { viewId: string; webviewId: string } | undefined;
    let requested = false;

    const resolveIfVisible = (): void => {
      const rpc = connection.rpc;
      if (!rpc || requested || !layout.sidebarVisible) {
        return;
      }
      requested = true;
      rpc.call('view.resolve', { viewType: SESSION_LIST_VIEW }).then(
        (found) => {
          if (!found) {
            placeholder.textContent = t('noSessionList');
          }
        },
        (error: unknown) => logger.error('resolving the session list failed', error),
      );
    };

    subscriptions.add(
      connection.onDidConnect((rpc) => {
        requested = false;
        rpc.handle('view.create', ({ viewId, webviewId, viewType }) => {
          if (viewType !== SESSION_LIST_VIEW) {
            logger.warn(`ignoring unexpected view ${viewType}`);
            return;
          }
          view = { viewId, webviewId };
          placeholder.hidden = true;
          frames.create(webviewId, viewType, container, t('sessions'));
        });
        rpc.handle('view.reveal', () => layout.setSidebarVisible(true));
        rpc.handle('view.update', () => {});
        rpc.handle('view.dispose', ({ viewId }) => {
          if (view?.viewId === viewId) {
            frames.dispose(view.webviewId);
            view = undefined;
            placeholder.hidden = false;
          }
        });
        resolveIfVisible();
      }),
    );
    subscriptions.add(
      connection.onDidDisconnect(() => {
        view = undefined;
        placeholder.hidden = false;
        placeholder.textContent = t('loading');
      }),
    );
    subscriptions.add(
      layout.onDidChangeSidebarVisibility((visible) => {
        if (view) {
          connection.rpc?.notify('view.didChangeVisibility', { viewId: view.viewId, visible });
        }
        resolveIfVisible();
      }),
    );

    const toggle = document.createElement('button');
    toggle.className = 'icon-button titlebar-button icon-sidebar';
    toggle.title = t('toggleTooltip');
    toggle.setAttribute('aria-label', t('toggleSessionList'));
    toggle.addEventListener('click', () => layout.toggleSidebar());
    const syncToggle = (): void => {
      toggle.classList.toggle('checked', layout.sidebarVisible);
    };
    syncToggle();
    subscriptions.add(layout.onDidChangeSidebarVisibility(syncToggle));
    subscriptions.add(layout.addTitleBarItem('left', toggle, 0));

    subscriptions.add(
      commands.register('sessions.toggleSidebar', () => layout.toggleSidebar(), {
        title: t('toggleSessionList'),
        category: CommandCategory.view,
      }),
    );
    subscriptions.add(keybindings.register({ key: 'ctrl+b', command: 'sessions.toggleSidebar' }));
  },
};
