import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';

import { createWindowNamespace, type WindowDependencies } from '../../../src/compat/vscode/window';
import type { InputBoxRequest } from '../../../src/platform/protocol';

type ShowInputBox = (options?: vscode.InputBoxOptions) => Promise<string | undefined>;

/** `window.showInputBox` over a fake shell input box that returns `answers` in turn. */
function inputBoxWithAnswers(answers: (string | undefined)[]): { showInputBox: ShowInputBox; requests: InputBoxRequest[] } {
  const requests: InputBoxRequest[] = [];
  const deps = {
    host: {
      themeKind: 'vscode-dark',
      ui: {
        showInputBox: async (request: InputBoxRequest) => {
          requests.push(request);
          return answers.shift();
        },
      },
    },
    documents: {},
    editors: {},
  } as unknown as WindowDependencies;
  const window = createWindowNamespace(deps) as { showInputBox: ShowInputBox };
  return { showInputBox: window.showInputBox, requests };
}

const notEmpty = (value: string) => (value.trim() ? undefined : 'Enter a session name');

describe('window.showInputBox', () => {
  test('without validateInput, asks once', async () => {
    const { showInputBox, requests } = inputBoxWithAnswers(['x']);
    assert.equal(await showInputBox({ prompt: 'Name', value: 'old' }), 'x');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.value, 'old');
    assert.equal(requests[0]?.validationMessage, undefined);
  });

  test('a rejected value is asked again with the message, keeping what was typed', async () => {
    const { showInputBox, requests } = inputBoxWithAnswers(['  ', 'New name']);
    assert.equal(await showInputBox({ prompt: 'Rename session tab', value: 'Old', validateInput: notEmpty }), 'New name');
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.value, '  ');
    assert.equal(requests[1]?.validationMessage, 'Enter a session name');
    assert.equal(requests[1]?.prompt, 'Rename session tab');
  });

  test('Escape after a rejection cancels', async () => {
    const { showInputBox } = inputBoxWithAnswers(['', undefined]);
    assert.equal(await showInputBox({ validateInput: notEmpty }), undefined);
  });

  test('an async validateInput works', async () => {
    const { showInputBox, requests } = inputBoxWithAnswers(['', 'ok']);
    assert.equal(await showInputBox({ validateInput: async (value) => notEmpty(value) }), 'ok');
    assert.equal(requests.length, 2);
  });

  test('only Error severity blocks; Info and Warning messages accept the value', async () => {
    const severity = { Info: 1, Warning: 2, Error: 3 } as const;
    const info = inputBoxWithAnswers(['fine']);
    const infoResult = await info.showInputBox({
      validateInput: () => ({ message: 'just so you know', severity: severity.Info as vscode.InputBoxValidationSeverity }),
    });
    assert.equal(infoResult, 'fine');

    const error = inputBoxWithAnswers(['bad', 'good']);
    const errorResult = await error.showInputBox({
      validateInput: (value) =>
        value === 'bad' ? { message: 'not that one', severity: severity.Error as vscode.InputBoxValidationSeverity } : null,
    });
    assert.equal(errorResult, 'good');
    assert.equal(error.requests[1]?.validationMessage, 'not that one');
  });
});
