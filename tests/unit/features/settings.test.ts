import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { SettingDefinition } from '../../../src/core/settings';
import { extensionSettingDefinitions } from '../../../src/features/settings/extensionSettings';
import {
  controlKind,
  defaultSettingsText,
  groupBySection,
  matchesQuery,
  parseNumber,
  plainText,
  settingTitle,
  settingsJsonSchema,
} from '../../../src/features/settings/settingItems';

const definition = (key: string, section = 'S', order?: number, description = ''): SettingDefinition => ({
  key,
  section,
  order,
  schema: { type: 'string', description },
});

describe('settingTitle (as VS Code shows keys)', () => {
  test('category from the leading segments, name from the last', () => {
    assert.deepEqual(settingTitle('editor.fontSize'), { category: 'Editor', name: 'Font Size' });
    assert.deepEqual(settingTitle('editor.minimap.enabled'), { category: 'Editor › Minimap', name: 'Enabled' });
    assert.deepEqual(settingTitle('claudeCode.useCtrlEnterToSend'), { category: 'Claude Code', name: 'Use Ctrl Enter To Send' });
    assert.deepEqual(settingTitle('solo'), { category: '', name: 'Solo' });
  });
});

describe('plainText', () => {
  test('unwraps code spans, links, emphasis and setting references', () => {
    assert.equal(plainText('Use `bash` or [docs](https://x.y) **now**.'), 'Use bash or docs now.');
    assert.equal(plainText('See `#editor.fontSize#` too.'), 'See Editor: Font Size too.');
  });
});

describe('controlKind', () => {
  test('by enum first, then by type (null ignored)', () => {
    assert.equal(controlKind({ type: 'string', enum: ['a', 'b'] }), 'enum');
    assert.equal(controlKind({ type: 'boolean' }), 'boolean');
    assert.equal(controlKind({ type: ['string', 'null'] }), 'string');
    assert.equal(controlKind({ type: 'integer' }), 'number');
    assert.equal(controlKind({ type: 'array' }), 'complex');
    assert.equal(controlKind({}), 'complex');
  });
});

describe('matchesQuery', () => {
  test('every word in the key, title, description or section', () => {
    const fontSize = definition('editor.fontSize', 'Text Editor', 0, 'Controls the font size in pixels.');
    assert.equal(matchesQuery(fontSize, 'font size'), true);
    assert.equal(matchesQuery(fontSize, 'PIXELS editor'), true);
    assert.equal(matchesQuery(fontSize, 'font family'), false);
    assert.equal(matchesQuery(fontSize, '  '), true);
  });
});

describe('parseNumber', () => {
  test('a number within the bounds, else why not', () => {
    const schema = { type: 'number', minimum: 6, maximum: 100 };
    assert.deepEqual(parseNumber(schema, ' 14 '), { value: 14 });
    assert.deepEqual(parseNumber(schema, 'big'), { error: 'notNumber' });
    assert.deepEqual(parseNumber(schema, ''), { error: 'notNumber' });
    assert.deepEqual(parseNumber(schema, '2'), { error: 'tooSmall' });
    assert.deepEqual(parseNumber(schema, '101'), { error: 'tooLarge' });
    assert.deepEqual(parseNumber({ type: 'integer' }, '1.5'), { error: 'notInteger' });
  });
});

describe('groupBySection', () => {
  test('sections in registration order, settings by order then key', () => {
    const groups = groupBySection([
      definition('b.second', 'B'),
      definition('a.z', 'A', 2),
      definition('a.y', 'A', 1),
      definition('b.first', 'B'),
      definition('a.x', 'A'),
    ]);
    assert.deepEqual(
      groups.map((group) => [group.section, group.settings.map((setting) => setting.key)]),
      [
        ['B', ['b.first', 'b.second']],
        ['A', ['a.y', 'a.z', 'a.x']],
      ],
    );
  });
});

describe('settingsJsonSchema', () => {
  test('one property per declared setting, unknown keys allowed', () => {
    const schema = settingsJsonSchema([definition('a.b'), { key: 'n', section: 'S', schema: { type: 'number', minimum: 1 } }]);
    assert.deepEqual(schema, {
      type: 'object',
      additionalProperties: true,
      properties: { 'a.b': { type: 'string', description: '' }, n: { type: 'number', minimum: 1 } },
    });
  });
});

describe('defaultSettingsText', () => {
  test('JSON with comments: sections, descriptions, described values, defaults; no comma after the last', () => {
    const text = defaultSettingsText(
      [
        { key: 'a.size', section: 'A', schema: { type: 'number', default: 14, description: 'The `size`.' } },
        { key: 'b.mode', section: 'B', schema: { type: 'string', default: 'on', enum: ['on', 'off'], enumDescriptions: ['On.', ''] } },
        { key: 'b.list', section: 'B', schema: { type: 'array', default: ['x'], deprecationMessage: 'Gone.' } },
        { key: 'b.weight', section: 'B', schema: { type: 'string', default: 'normal', enum: ['normal', 'bold'] } },
      ],
      { header: 'Defaults.\nRead only.', deprecated: 'Deprecated' },
    );
    assert.equal(
      text,
      [
        '// Defaults.',
        '// Read only.',
        '{',
        '',
        '  // ---- A ----',
        '',
        '  // The size.',
        '  "a.size": 14,',
        '',
        '  // ---- B ----',
        '',
        '  // Deprecated: Gone.',
        '  "b.list": [',
        '    "x"',
        '  ],',
        '',
        '  //  - "on": On.',
        '  //  - "off"',
        '  "b.mode": "on",',
        '',
        '  "b.weight": "normal"',
        '}',
        '',
      ].join('\n'),
    );
  });
});

describe('extensionSettingDefinitions', () => {
  test("keeps the manifest's order and hides settings for VS Code integration", () => {
    const definitions = extensionSettingDefinitions({
      commands: [],
      menus: {},
      configuration: [
        { key: 'claudeCode.useTerminal', schema: { type: 'boolean' }, section: 'Claude Code' },
        { key: 'claudeCode.autosave', schema: { type: 'boolean', order: 3 }, section: 'Claude Code' },
      ],
    });
    assert.deepEqual(
      definitions.map((setting) => [setting.key, setting.order, setting.hidden]),
      [
        ['claudeCode.useTerminal', 1000, true],
        ['claudeCode.autosave', 3, false],
      ],
    );
  });
});
