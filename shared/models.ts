import { z } from 'zod';

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

/**
 * Models an admin can pick on the Settings page, best first. Notes come from
 * `npm run eval` (4 Nov 2026: 12 questions on 3 charts, 33 expected facts).
 * Paid models run through AI Gateway (prepaid credits); free ones call
 * Workers AI directly so they use the free daily allowance.
 */
export const SELECTABLE_MODELS = [
  {
    id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    summary:
      'Most accurate in our tests: 33/33 chart facts, no chart errors. About 19 s and 350 neurons (≈ $0.004) an answer.',
  },
  {
    id: '@cf/zai-org/glm-5.3-flash',
    summary:
      'Also 33/33 chart facts, with one chart error in 12 answers. Cheapest paid option: about 18 s and 200 neurons (≈ $0.002) an answer.',
  },
  {
    id: '@cf/openai/gpt-oss-120b',
    summary:
      'No credits needed. 30/33 chart facts, one chart error, and once missed the unknown-birth-time warning. Slower: about 45 s and 310 neurons an answer.',
  },
] as const;

export type SelectableModelId = (typeof SELECTABLE_MODELS)[number]['id'];
export const isSelectableModel = (id: string): id is SelectableModelId =>
  SELECTABLE_MODELS.some((m) => m.id === id);

export const ModelChoiceInputSchema = z.object({
  model: z.enum(SELECTABLE_MODELS.map((m) => m.id) as [SelectableModelId, ...SelectableModelId[]]),
});

export const ModelChoiceSchema = z.object({
  /** The model answering new questions now. */
  model: z.string(),
  /** The deploy-time default (`AI_MODEL`), used when no admin has picked one. */
  defaultModel: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
  options: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      billing: z.enum(['free', 'credits']),
      summary: z.string(),
    }),
  ),
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;
