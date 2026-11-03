import { describe, expect, it } from 'vitest';
import { titleFromQuestion } from '../../shared/session';
import { SseParser, sseEvent } from '../../shared/sse';
import { parseModelStream, type LlmEvent } from '../../worker/services/llm';
import { buildPrompt, systemPrompt } from '../../worker/services/prompts';

function streamOf(text: string, chunkSize = 7) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < text.length; i += chunkSize)
        c.enqueue(enc.encode(text.slice(i, i + chunkSize)));
      c.close();
    },
  });
}
async function collect(it: AsyncIterable<LlmEvent>) {
  const out: LlmEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('parseModelStream', () => {
  it('reads OpenAI chunks split across reads, ignoring reasoning and stopping at [DONE]', async () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n' +
      'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n';
    expect(await collect(parseModelStream(streamOf(sse)))).toEqual([
      { type: 'token', text: 'Hello' },
      { type: 'token', text: ' world' },
      { type: 'usage', tokensIn: 10, tokensOut: 2 },
    ]);
  });

  it('reads the legacy Workers AI { response } format', async () => {
    const sse =
      'data: {"response":"Na"}\r\n\r\ndata: {"response":"maste"}\r\n\r\ndata: [DONE]\r\n\r\n';
    const tokens = (await collect(parseModelStream(streamOf(sse, 3)))).map(
      (e) => e.type === 'token' && e.text,
    );
    expect(tokens.join('')).toBe('Namaste');
  });
});

describe('SseParser', () => {
  it('round-trips events across arbitrary chunk boundaries', () => {
    const text = sseEvent('token', { text: 'a\nb' }) + sseEvent('done', { id: 1 });
    const p = new SseParser();
    const events = [...text].flatMap((ch) => p.push(ch)).concat(p.end());
    expect(events).toEqual([
      { event: 'token', data: '{"text":"a\\nb"}' },
      { event: 'done', data: '{"id":1}' },
    ]);
  });
});

describe('buildPrompt', () => {
  const base = { lang: 'en', digest: 'DIGEST', today: '2026-11-03', timeUncertain: false };

  it('trims the oldest history first and never starts with an assistant turn', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `${i}`.padEnd(300, '.'),
    }));
    const msgs = buildPrompt({ ...base, history, question: 'Q', historyBudget: 350 });
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[1]?.content.startsWith('8')).toBe(true);
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'Q' });
    expect(msgs[0]?.content).toContain('CHART DATA:\nDIGEST');
  });

  it('covers the safety rules and language', () => {
    const s = systemPrompt('te');
    for (const rule of [
      'Never predict death',
      'qualified professional',
      'TIME-UNCERTAIN',
      'politely decline',
      'Answer in Telugu',
    ]) {
      expect(s).toContain(rule);
    }
  });
});

describe('titleFromQuestion', () => {
  it('keeps at most six words and drops trailing punctuation', () => {
    expect(titleFromQuestion('what does my current dasha indicate?')).toBe(
      'What does my current dasha indicate',
    );
    expect(titleFromQuestion('Will I  get a good job in the next two years?')).toBe(
      'Will I get a good job…',
    );
  });
});

describe('findDegeneration', () => {
  it('flags leaked chat-template markers and repetition loops', async () => {
    const { findDegeneration } = await import('../../worker/services/llm');
    expect(findDegeneration('A clean answer about Jupiter.')).toBe(-1);
    expect(findDegeneration('Good start. <|end|><|start|>assistantfinal more')).toBe(12);
    expect(findDegeneration('answer: assistantfinal x')).toBe(8);
    const loop = 'Jupiter MD ' + 'Mah '.repeat(20);
    expect(findDegeneration(loop)).toBe('Jupiter MD'.length);
    // Normal repetition (a word a few times) is fine.
    expect(findDegeneration('very very very good')).toBe(-1);
  });
});
