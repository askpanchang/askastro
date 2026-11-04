import { z } from 'zod';

/**
 * Workers AI neurons per million tokens, from Cloudflare's pricing page
 * (Nov 2026). Neurons are what the daily allowance is measured in.
 */
export const NEURON_RATES: Readonly<Record<string, { in: number; out: number }>> = {
  '@cf/openai/gpt-oss-120b': { in: 31_818, out: 68_182 },
  '@cf/openai/gpt-oss-20b': { in: 18_182, out: 27_273 },
  // Others converted from $ per M tokens at $0.011 per 1,000 neurons.
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017': { in: 27_273, out: 109_091 },
  '@cf/qwen/qwen3.8-27b': { in: 40_909, out: 290_909 },
  '@cf/nvidia/nemotron-3-120b-a12b': { in: 45_455, out: 136_364 },
  '@cf/google/gemma-4-26b-a4b-it': { in: 9_091, out: 27_273 },
  '@cf/moonshotai/kimi-k2.6': { in: 86_364, out: 363_636 },
};

/** Estimated neurons for one answer. Unknown models use gpt-oss-120b rates; the dev echo model is free. */
export function neuronsFor(model: string, tokensIn: number, tokensOut: number): number {
  if (model === 'dev:echo') return 0;
  const r = NEURON_RATES[model] ?? NEURON_RATES['@cf/openai/gpt-oss-120b']!;
  return (tokensIn * r.in + tokensOut * r.out) / 1_000_000;
}

/** Start of the current Workers AI day (00:00 UTC) and the next reset. */
export function utcDay(nowMs: number) {
  const start = new Date(nowMs);
  start.setUTCHours(0, 0, 0, 0);
  const next = new Date(start.getTime() + 24 * 3600_000);
  return {
    day: start.toISOString().slice(0, 10),
    start: start.toISOString(),
    resetsAt: next.toISOString(),
  };
}

const PersonUsage = z.object({ email: z.string(), neurons: z.number(), questions: z.number() });

export const UsageSchema = z.object({
  day: z.string(),
  resetsAt: z.string(),
  /** Account-wide daily neuron allowance (the Workers AI free allowance unless configured otherwise). */
  budget: z.number(),
  /** Your daily neuron limit; null for admins, who can use everything available (free + credits). */
  userLimit: z.number().nullable(),
  /** The daily limit for non-admin users. */
  memberLimit: z.number(),
  you: PersonUsage.omit({ email: true }),
  account: z.object({
    neurons: z.number(),
    /** 'cloudflare': real account total from Cloudflare analytics; 'estimate': this app's users only. */
    source: z.enum(['cloudflare', 'estimate']),
  }),
  /** Admins only: today's usage per person, highest first; limit null = admin (no cap). */
  people: z.array(PersonUsage.extend({ limit: z.number().nullable() })).optional(),
  /** Admins only: last 7 UTC days, oldest first. */
  history: z
    .array(
      z.object({ day: z.string(), appNeurons: z.number(), accountNeurons: z.number().nullable() }),
    )
    .optional(),
});
export type Usage = z.infer<typeof UsageSchema>;
