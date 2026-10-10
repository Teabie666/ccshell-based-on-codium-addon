/**
 * Starting points for new providers, from each provider's own Claude Code setup page
 * (checked 2026-10-10). Model names change often, so a preset is only where a provider
 * starts: everything can be edited, and `docs` links to the current instructions.
 */

import type { ProviderConfig } from '../../platform/providers';
import { t } from './messages';

export interface ProviderPreset {
  readonly id: string;
  /** Brand names stay as they are; descriptive ones are translated. */
  readonly name: () => string;
  /** The provider's setup page for Claude Code. */
  readonly docs?: string;
  readonly config: Omit<ProviderConfig, 'id' | 'name' | 'preset'>;
}

/** The part of a base URL the user has to fill in (Alibaba Cloud's pay-as-you-go endpoints). */
export const URL_PLACEHOLDER = /\{[A-Za-z]+\}/;

const DEEPSEEK_DOCS = 'https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/';
const KIMI_DOCS = 'https://platform.kimi.com/docs/guide/claude-code-kimi';
const QWEN_DOCS = 'https://help.aliyun.com/zh/model-studio/claude-code';
const QWEN_INTL_DOCS = 'https://www.alibabacloud.com/help/en/model-studio/claude-code';

const kimiModels = {
  main: 'kimi-k3[1m]',
  opus: 'kimi-k3[1m]',
  sonnet: 'kimi-k3[1m]',
  haiku: 'kimi-k2.7-code',
  fable: 'kimi-k3[1m]',
  subagent: 'kimi-k3[1m]',
};
const kimiEnv = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000', CLAUDE_CODE_EFFORT_LEVEL: 'max' };
const qwenCodingModels = { main: 'qwen3.7-plus', opus: 'qwen3.7-plus', sonnet: 'qwen3.7-plus', haiku: 'qwen3.7-plus' };
const qwenModels = {
  main: 'qwen3.7-max',
  opus: 'qwen3.7-max',
  sonnet: 'qwen3.7-max',
  haiku: 'qwen3.6-flash',
  subagent: 'qwen3.7-max',
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'anthropic',
    name: () => 'Anthropic API',
    docs: 'https://code.claude.com/docs/en/settings#environment-variables',
    config: { type: 'anthropic-api', auth: 'apiKey', color: '#d97757' },
  },
  {
    id: 'deepseek',
    name: () => 'DeepSeek',
    docs: DEEPSEEK_DOCS,
    config: {
      type: 'compatible',
      baseUrl: 'https://api.deepseek.com/anthropic',
      auth: 'bearer',
      models: {
        main: 'deepseek-flash[1m]',
        opus: 'deepseek-flash[1m]',
        sonnet: 'deepseek-flash[1m]',
        haiku: 'deepseek-flash',
        subagent: 'deepseek-flash',
      },
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432', CLAUDE_CODE_EFFORT_LEVEL: 'max' },
      color: '#4d6bfe',
    },
  },
  {
    id: 'kimi',
    name: () => 'Kimi',
    docs: KIMI_DOCS,
    config: {
      type: 'compatible',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      auth: 'bearer',
      models: kimiModels,
      env: kimiEnv,
      color: '#0ea5a4',
    },
  },
  {
    id: 'kimi-intl',
    name: () => 'Kimi (moonshot.ai)',
    docs: KIMI_DOCS,
    config: {
      type: 'compatible',
      baseUrl: 'https://api.moonshot.ai/anthropic',
      auth: 'bearer',
      models: kimiModels,
      env: kimiEnv,
      color: '#0ea5a4',
    },
  },
  {
    id: 'glm',
    name: () => t('presetGlm'),
    docs: 'https://docs.bigmodel.cn/cn/guide/develop/claude',
    config: {
      type: 'compatible',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      auth: 'bearer',
      models: { opus: 'glm-5.2[1m]', sonnet: 'glm-5.2[1m]', haiku: 'glm-4.7' },
      timeoutMs: 3000000,
      disableNonessentialTraffic: true,
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' },
      color: '#e8833a',
    },
  },
  {
    id: 'zai',
    name: () => 'Z.ai GLM',
    docs: 'https://docs.z.ai/scenario-example/develop-tools/claude',
    config: {
      type: 'compatible',
      baseUrl: 'https://api.z.ai/api/anthropic',
      auth: 'bearer',
      models: { opus: 'GLM-4.7', sonnet: 'GLM-4.7', haiku: 'GLM-4.5-Air' },
      timeoutMs: 3000000,
      color: '#e8833a',
    },
  },
  {
    id: 'qwen-coding',
    name: () => t('presetQwenCoding'),
    docs: QWEN_DOCS,
    config: {
      type: 'compatible',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      auth: 'bearer',
      models: qwenCodingModels,
      color: '#7c5cff',
    },
  },
  {
    id: 'qwen',
    name: () => t('presetQwen'),
    docs: QWEN_DOCS,
    config: {
      type: 'compatible',
      baseUrl: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/apps/anthropic',
      auth: 'bearer',
      models: qwenModels,
      color: '#7c5cff',
    },
  },
  {
    id: 'qwen-coding-intl',
    name: () => t('presetQwenCodingIntl'),
    docs: QWEN_INTL_DOCS,
    config: {
      type: 'compatible',
      baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
      auth: 'bearer',
      models: qwenCodingModels,
      color: '#7c5cff',
    },
  },
  {
    id: 'qwen-intl',
    name: () => t('presetQwenIntl'),
    docs: QWEN_INTL_DOCS,
    config: {
      type: 'compatible',
      baseUrl: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
      auth: 'bearer',
      models: qwenModels,
      color: '#7c5cff',
    },
  },
  {
    id: 'custom',
    name: () => t('presetCustom'),
    config: { type: 'compatible', auth: 'bearer', color: '#8a8a8a' },
  },
];

export function presetById(id: string | undefined): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}
