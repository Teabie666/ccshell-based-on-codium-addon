/**
 * Renderer entry point: lists the shell modules and starts the workbench.
 * To add a feature, write a module under src/features/ and add it here.
 */

import { createRendererLogger } from '../../core/log';
import { t } from '../../core/messages';
import type { ShellModule } from '../../core/module';
import { startWorkbench } from '../../core/workbench';
import { commandPaletteModule } from '../../features/commandPalette';
import { contentPaneModule } from '../../features/contentPane';
import { conversationsModule } from '../../features/conversations';
import { editorModule } from '../../features/editor';
import { markdownModule } from '../../features/markdown';
import { quickOpenModule } from '../../features/quickOpen';
import { extensionHostStatusModule } from '../../features/extensionHostStatus';
import { extensionMenusModule } from '../../features/extensionMenus';
import { languageModule } from '../../features/language';
import { sessionsModule } from '../../features/sessions';
import { settingsModule } from '../../features/settings';
import { themesModule } from '../../features/themes';
import { windowModule } from '../../features/window';

const modules: ShellModule[] = [
  windowModule,
  conversationsModule,
  contentPaneModule,
  editorModule,
  markdownModule,
  quickOpenModule,
  settingsModule,
  sessionsModule,
  themesModule,
  languageModule,
  commandPaletteModule,
  extensionMenusModule,
  extensionHostStatusModule,
];

startWorkbench(modules).catch((error: unknown) => {
  createRendererLogger('renderer').error('workbench failed to start', error);
  document.body.textContent = t('startupFailed', String(error));
});
