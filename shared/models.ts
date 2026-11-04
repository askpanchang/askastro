/**
 * Per-model request settings for Workers AI chat models. Reasoning levels and
 * recommended temperatures differ by model (from each model's catalog page).
 */
export type ModelSettings = {
  label: string;
  /** Value for `reasoning_effort`, or null to omit it. */
  reasoningEffort: string | null;
  temperature: number;
  /** Needs Workers Paid or AI Gateway credits. */
  paid: boolean;
};

export const MODEL_SETTINGS: Readonly<Record<string, ModelSettings>> = {
  '@cf/openai/gpt-oss-120b': {
    label: 'gpt-oss-120b',
    reasoningEffort: 'high',
    temperature: 1,
    paid: false,
  },
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': {
    label: 'DeepSeek V4.1 Flash',
    reasoningEffort: 'high',
    temperature: 0.6,
    paid: true,
  },
  '@cf/moonshotai/kimi-k2.6': {
    label: 'Kimi K2.6',
    reasoningEffort: 'high',
    temperature: 1,
    paid: true,
  },
  '@cf/zai-org/glm-5.3-flash': {
    label: 'GLM 5.3 Flash',
    reasoningEffort: 'high',
    temperature: 1,
    paid: true,
  },
  '@cf/qwen/qwen3.8-27b': {
    label: 'Qwen 3.8 27B',
    reasoningEffort: 'medium',
    temperature: 0.6,
    paid: false,
  },
  '@cf/nvidia/nemotron-3-120b-a12b': {
    label: 'Nemotron 3 120B',
    reasoningEffort: null,
    temperature: 0.6,
    paid: false,
  },
};

export const modelSettings = (model: string): ModelSettings =>
  MODEL_SETTINGS[model] ?? { label: model, reasoningEffort: null, temperature: 0.6, paid: false };
