import { modelSettings } from '../../shared/models';
import { SseParser } from '../../shared/sse';
import { AppError } from '../lib/errors';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmEvent =
  { type: 'token'; text: string } | { type: 'usage'; tokensIn: number; tokensOut: number };

/** Everything model-specific lives behind this interface (BUILD_PROMPT §7.3). */
export interface LlmClient {
  readonly model: string;
  stream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<LlmEvent>;
}

/** Answer budget. gpt-oss counts reasoning tokens against max_tokens too. */
const MAX_TOKENS = 4096;

/**
 * Workers AI chat-completions adapter, verified for @cf/openai/gpt-oss-120b
 * (input: `messages` + `reasoning_effort`; output: OpenAI-style chunks).
 * Also understands the older Workers AI `{ response }` chunk format.
 */
export class WorkersAiLlm implements LlmClient {
  readonly model: string;

  constructor(private readonly env: Pick<Env, 'AI' | 'AI_MODEL' | 'AI_GATEWAY_ID'>) {
    this.model = env.AI_MODEL;
  }

  async *stream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<LlmEvent> {
    const settings = modelSettings(this.model);
    const input = {
      messages,
      stream: true,
      max_tokens: MAX_TOKENS,
      // Per model: gpt-oss wants temperature 1.0 (lower values looped and leaked
      // its chat template in live tests); reasoning levels differ by model.
      temperature: settings.temperature,
      ...(settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
      stream_options: { include_usage: true },
    };
    const options = this.env.AI_GATEWAY_ID ? { gateway: { id: this.env.AI_GATEWAY_ID } } : {};
    let body: unknown;
    try {
      // The model id is configuration, so the per-model typings can't be used here.
      body = await (this.env.AI.run as (m: string, i: unknown, o: unknown) => Promise<unknown>)(
        this.model,
        input,
        options,
      );
    } catch (err) {
      // Free plan: Workers AI refuses calls once the daily neuron allowance is used (error 4006).
      if (/\b4006\b|daily free allocation|neurons/i.test(err instanceof Error ? err.message : '')) {
        throw new AppError(
          429,
          'ACCOUNT_AI_LIMIT',
          "Today's AI allowance for the app is used up. It resets at 00:00 UTC (5:30 AM IST).",
        );
      }
      throw new AppError(502, 'AI_UPSTREAM_ERROR', 'The AI model is unavailable right now.');
    }
    if (!(body instanceof ReadableStream)) {
      throw new AppError(502, 'AI_UPSTREAM_ERROR', 'The AI model returned an unexpected response.');
    }
    yield* parseModelStream(body as ReadableStream<Uint8Array>, signal);
  }
}

/** Parse a Workers AI SSE stream into tokens and usage. Exported for tests. */
export async function* parseModelStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<LlmEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort);
  let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      const events = done ? parser.end() : parser.push(decoder.decode(value, { stream: true }));
      for (const ev of events) {
        if (ev.data === '[DONE]') {
          finished = true;
          return;
        }
        let json: unknown;
        try {
          json = JSON.parse(ev.data);
        } catch {
          continue;
        }
        yield* chunkEvents(json);
      }
      if (done) {
        finished = true;
        return;
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // Consumer stopped early (Stop, error, malformed output): stop the model too.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type Chunk = {
  response?: unknown;
  choices?: { delta?: { content?: unknown }; text?: unknown }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

function* chunkEvents(json: unknown): Iterable<LlmEvent> {
  const c = json as Chunk;
  // OpenAI chat.completion.chunk: answer text in delta.content; reasoning is ignored.
  const delta = c.choices?.[0]?.delta?.content ?? c.choices?.[0]?.text;
  if (typeof delta === 'string' && delta) yield { type: 'token', text: delta };
  // Legacy Workers AI format.
  if (typeof c.response === 'string' && c.response) yield { type: 'token', text: c.response };
  if (c.usage && typeof c.usage.prompt_tokens === 'number') {
    yield {
      type: 'usage',
      tokensIn: c.usage.prompt_tokens,
      tokensOut: c.usage.completion_tokens ?? 0,
    };
  }
}

/**
 * Local-development stand-in, used only when AI_MODEL is "dev:echo" (e.g. in
 * .dev.vars for `npm run dev:local`). Streams a canned answer that quotes the
 * chart context it received, so the Q&A flow works without Cloudflare access.
 */
export class DevEchoLlm implements LlmClient {
  readonly model = 'dev:echo';

  async *stream(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<LlmEvent> {
    const system = messages[0]?.content ?? '';
    const question = messages.at(-1)?.content ?? '';
    const pick = (re: RegExp) => system.match(re)?.[0] ?? 'not in the chart data';
    const answer = [
      `**Development echo model.** No AI was called. You asked: “${question}”.`,
      '',
      '### Why (chart factors)',
      `- ${pick(/Lagna \(ascendant\):[^\n]*/)}`,
      `- ${pick(/Moon sign \(rashi\):[^\n]*/)}`,
      `- ${pick(/Current: [^\n]*/)}`,
      '',
      `_Context sent: ${messages.length} messages, about ${Math.round(system.length / 3)} tokens of instructions and chart data._`,
    ].join('\n');
    const words = answer.split(/(?<=\s)/);
    for (const w of words) {
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 15));
      yield { type: 'token', text: w };
    }
    yield { type: 'usage', tokensIn: Math.round(system.length / 3), tokensOut: words.length };
  }
}

/**
 * Detects broken model output: leaked chat-template markers (gpt-oss's
 * "<|start|>…<|end|>" / "assistantfinal") or a runaway repetition loop.
 * Returns the index where the clean text ends, or -1 if the text looks fine.
 */
export function findDegeneration(text: string): number {
  const marker = text.search(/<\|(?:start|end|channel|message|return)\|>|assistantfinal/);
  if (marker >= 0) return marker;
  // The same short word repeated 12+ times in a row.
  const loop = /(?:^|\s)(\S{1,24})(?:\s+\1){11,}/u.exec(text);
  return loop ? loop.index : -1;
}
