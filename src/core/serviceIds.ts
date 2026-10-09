/**
 * Ids of the core services every shell module can use. A module that offers a service to
 * other modules declares its id next to its implementation (in its own feature folder).
 */

import type { CommandService } from './commands';
import type { ContextKeyService } from './contextKeys';
import type { Dialogs } from './dialogs';
import type { ExtensionHostConnection } from './extensionHost';
import type { KeybindingService } from './keybindings';
import type { Layout } from './layout';
import type { MenuService } from './menus';
import type { NativeApi } from './native';
import { createServiceId } from './services';
import type { ThemeService } from './themes';
import type { WebviewFrames } from './webviewFrames';

export interface WorkspaceInfo {
  readonly folders: readonly string[];
  /** Display name: the first folder's base name. */
  readonly name: string;
}

export const ICommands = createServiceId<CommandService>('commands');
export const IKeybindings = createServiceId<KeybindingService>('keybindings');
export const IContextKeys = createServiceId<ContextKeyService>('contextKeys');
export const IMenus = createServiceId<MenuService>('menus');
export const ILayout = createServiceId<Layout>('layout');
export const IWebviewFrames = createServiceId<WebviewFrames>('webviewFrames');
export const IDialogs = createServiceId<Dialogs>('dialogs');
export const IExtensionHost = createServiceId<ExtensionHostConnection>('extensionHost');
export const INative = createServiceId<NativeApi>('native');
export const IThemes = createServiceId<ThemeService>('themes');
export const IWorkspace = createServiceId<WorkspaceInfo>('workspace');
