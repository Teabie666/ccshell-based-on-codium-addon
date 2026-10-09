/**
 * Extension webview panels opened beside the conversation (e.g. the plan preview) shown
 * as content pane tabs.
 */

import type { EditorInput, EditorPane, EditorProvider } from '../../core/editors';
import type { ExtensionHostConnection } from '../../core/extensionHost';
import type { PanelHost } from '../../core/panels';
import type { WebviewFrames } from '../../core/webviewFrames';
import type { ContentPane } from './contentPane';

const WEBVIEW_INPUT = 'webview';

interface WebviewInputData {
  readonly panelId: string;
  readonly webviewId: string;
  readonly viewType: string;
}

function inputId(panelId: string): string {
  return `webview:${panelId}`;
}

export function createWebviewEditorProvider(frames: WebviewFrames, connection: ExtensionHostConnection): EditorProvider {
  return {
    id: 'webview',
    accepts: (input) => input.typeId === WEBVIEW_INPUT,
    create(container, input): EditorPane {
      const { panelId, webviewId, viewType } = input.data as WebviewInputData;
      frames.create(webviewId, viewType, container, input.label);
      let visible = false;
      return {
        layout: () => {},
        setVisible: (value) => {
          if (value !== visible) {
            visible = value;
            connection.rpc?.notify('panel.didChangeViewState', { panelId, active: value, visible: value });
          }
        },
        focus: () => frames.focus(webviewId),
        // The page reloads in its new place; the plan preview asks for its content again.
        relocate: (target) => frames.relocate(webviewId, target),
        confirmClose: () => {
          // The extension decides; it answers with panel.dispose, which removes the tab.
          connection.rpc?.notify('panel.didClose', { panelId });
          return Promise.resolve(false);
        },
        dispose: () => frames.dispose(webviewId),
      };
    },
  };
}

export function createSidePanelHost(contentPane: ContentPane): PanelHost {
  return {
    create(params) {
      const input: EditorInput = {
        id: inputId(params.panelId),
        typeId: WEBVIEW_INPUT,
        label: params.title,
        data: { panelId: params.panelId, webviewId: params.webviewId, viewType: params.viewType } satisfies WebviewInputData,
      };
      contentPane.open(input, { preserveFocus: params.preserveFocus });
    },
    update(params) {
      if (params.title !== undefined) {
        contentPane.setLabel(inputId(params.panelId), params.title);
      }
    },
    reveal(panelId, preserveFocus) {
      const tab = contentPane.get(inputId(panelId));
      if (tab) {
        contentPane.open(tab.input, { preserveFocus });
      }
    },
    remove(panelId) {
      contentPane.remove(inputId(panelId));
    },
  };
}

/** Webview tabs die with the extension host that owned them. */
export function removeWebviewTabs(contentPane: ContentPane): void {
  for (const tab of contentPane.tabs) {
    if (tab.input.typeId === WEBVIEW_INPUT) {
      contentPane.remove(tab.input.id);
    }
  }
}
