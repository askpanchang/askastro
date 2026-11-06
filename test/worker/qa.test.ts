import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import { KundaliResponseSchema } from '../../shared/kundali';
import { ProfileResponseSchema } from '../../shared/profile';
import {
  SessionDetailSchema,
  SessionListSchema,
  SessionResponseSchema,
} from '../../shared/session';
import { SseParser } from '../../shared/sse';
import { STOPPED_NOTE, streamTiming } from '../../worker/routes/sessions';
import { PROMPT_VERSION } from '../../worker/services/prompts';
import fixture from '../fixtures/askpanchang-sample.json';
import { ARJUN, api, freshOwner } from './helpers';

afterEach(() => vi.restoreAllMocks());

/** OpenAI-style chat.completion.chunk SSE, as gpt-oss-120b streams it. */
function modelStream(parts: string[], opts: { usage?: boolean; failAfter?: number } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (opts.failAfter !== undefined && i === opts.failAfter) {
        ctrl.error(new Error('model crashed'));
        return;
      }
      if (i < parts.length) {
        const chunk = { choices: [{ delta: { content: parts[i], reasoning_content: 'hmm' } }] };
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      } else if (i === parts.length) {
        if (opts.usage !== false) {
          const u = { choices: [], usage: { prompt_tokens: 1234, completion_tokens: 56 } };
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(u)}\n\n`));
        }
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      } else {
        ctrl.close();
      }
      i++;
    },
  });
}

function mockAi(factory: () => ReadableStream<Uint8Array>) {
  return vi
    .spyOn(env.AI, 'run')
    .mockImplementation((async () => factory()) as unknown as typeof env.AI.run);
}

async function setup(owner: string, profile: Record<string, unknown> = ARJUN) {
  const p = ProfileResponseSchema.parse(
    await (await api('/api/profiles', { method: 'POST', owner, json: profile })).json(),
  ).profile;
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(fixture)));
  const { kundali } = KundaliResponseSchema.parse(
    await (
      await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner, json: { lang: 'hi' } })
    ).json(),
  );
  spy.mockRestore();
  const session = SessionResponseSchema.parse(
    await (await api(`/api/profiles/${p.id}/sessions`, { method: 'POST', owner })).json(),
  ).session;
  return { profile: p, kundali, session };
}

async function ask(owner: string, sessionId: string, question: string) {
  if (!vi.isMockFunction(globalThis.fetch)) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('no', { status: 503 }),
    );
  }
  const res = await api(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    owner,
    json: { question },
  });
  const parser = new SseParser();
  const events = [...parser.push(await res.text()), ...parser.end()].map((e) => ({
    event: e.event,
    data: JSON.parse(e.data) as Record<string, unknown>,
  }));
  return { res, events };
}

describe('sessions', () => {
  it('needs a kundali, then pins the session to the latest one', async () => {
    const owner = freshOwner();
    const p = ProfileResponseSchema.parse(
      await (await api('/api/profiles', { method: 'POST', owner, json: ARJUN })).json(),
    ).profile;
    const res = await api(`/api/profiles/${p.id}/sessions`, { method: 'POST', owner });
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('NO_KUNDALI');

    const { kundali, session } = await setup(owner);
    expect(session).toMatchObject({
      kundaliId: kundali.id,
      title: 'New session',
      lang: 'hi', // defaults to the kundali's language
      model: env.AI_MODEL,
      messageCount: 0,
    });
  });

  it('streams an answer, stores both messages and titles the session', async () => {
    const owner = freshOwner();
    const { profile, session } = await setup(owner);
    const run = mockAi(() => modelStream(['Jupiter ', 'mahadasha ', 'favours growth.']));

    const { res, events } = await ask(owner, session.id, 'What does my current dasha indicate?');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(events.map((e) => e.event)).toEqual(['start', 'token', 'token', 'token', 'done']);
    expect(
      events
        .filter((e) => e.event === 'token')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('Jupiter mahadasha favours growth.');
    expect(events.at(-1)?.data).toMatchObject({ tokensIn: 1234, tokensOut: 56 });

    // Prompt: one system message with rules + chart data + today, then the question.
    const [model, input] = run.mock.calls[0]! as unknown as [
      string,
      { messages: { role: string; content: string }[]; stream: boolean; max_tokens: number },
    ];
    expect(model).toBe(env.AI_MODEL);
    expect(input.stream).toBe(true);
    expect(input.max_tokens).toBeGreaterThan(256);
    expect(input.messages).toHaveLength(2);
    expect(input.messages[0]?.content).toContain('Vedic (Jyotish) astrologer');
    expect(input.messages[0]?.content).toContain('CHART DATA:');
    expect(input.messages[0]?.content).toContain('Lagna (ascendant): Scorpio');
    expect(input.messages[0]?.content).toContain('Answer in English');
    expect(input.messages[0]?.content).toMatch(/Today: \d{4}-\d{2}-\d{2}/);
    expect(input.messages[1]).toEqual({
      role: 'user',
      content: 'What does my current dasha indicate?',
    });

    await vi.waitFor(async () => {
      const d = SessionDetailSchema.parse(
        await (await api(`/api/sessions/${session.id}`, { owner })).json(),
      );
      expect(d.messages.map((m) => [m.role, m.status, m.content])).toEqual([
        ['user', 'complete', 'What does my current dasha indicate?'],
        ['assistant', 'complete', 'Jupiter mahadasha favours growth.'],
      ]);
      // Answers carry their model and how long they took.
      expect(d.messages[1]).toMatchObject({ model: env.AI_MODEL, tokensIn: 1234, tokensOut: 56 });
      expect(d.messages[1]?.durationMs).toBeGreaterThanOrEqual(0);
      expect(d.messages[0]).toMatchObject({ model: null, durationMs: null });
      expect(d.session.title).toBe('What does my current dasha indicate');
      expect(d.kundaliOutdated).toBe(false);
    });
    const row = await env.DB.prepare(
      "SELECT prompt_version, tokens_in, tokens_out FROM qa_messages WHERE session_id = ? AND role = 'assistant'",
    )
      .bind(session.id)
      .first();
    expect(row).toEqual({ prompt_version: PROMPT_VERSION, tokens_in: 1234, tokens_out: 56 });

    // Second question carries the first turn as history.
    run.mockClear();
    await ask(owner, session.id, 'And career?');
    const second = run.mock.calls[0]![1] as { messages: { role: string }[] };
    expect(second.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);

    const list = SessionListSchema.parse(
      await (await api(`/api/profiles/${profile.id}/sessions`, { owner })).json(),
    );
    expect(list.items[0]?.messageCount).toBe(4);
  });

  it('keeps partial text and marks the answer as failed when the model errors', async () => {
    const owner = freshOwner();
    const { session } = await setup(owner);
    mockAi(() => modelStream(['Partial ', 'answer', 'never'], { failAfter: 2 }));
    const { events } = await ask(owner, session.id, 'Health tendencies?');
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'AI_ERROR' } });
    await vi.waitFor(async () => {
      const d = SessionDetailSchema.parse(
        await (await api(`/api/sessions/${session.id}`, { owner })).json(),
      );
      expect(d.messages.at(-1)).toMatchObject({ status: 'error', content: 'Partial answer' });
    });
  });

  it('stops a malformed answer and keeps only the clean part', async () => {
    const owner = freshOwner();
    const { session } = await setup(owner);
    mockAi(() =>
      modelStream(['Jupiter is strong. ', '<|end|><|start|>', 'assistantfinal ', 'junk']),
    );
    const { events } = await ask(owner, session.id, 'Overview?');
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'AI_MALFORMED_ANSWER' } });
    await vi.waitFor(async () => {
      const d = SessionDetailSchema.parse(
        await (await api(`/api/sessions/${session.id}`, { owner })).json(),
      );
      expect(d.messages.at(-1)).toMatchObject({ status: 'error', content: 'Jupiter is strong.' });
    });
  });

  it('appends a chart-check note when the answer misstates a lordship', async () => {
    const owner = freshOwner();
    const { session } = await setup(owner);
    mockAi(() => modelStream(['Venus, lord of the 2nd, ', 'brings wealth.']));
    const { events } = await ask(owner, session.id, 'Money?');
    expect(events.at(-1)?.event).toBe('done');
    await vi.waitFor(async () => {
      const d = SessionDetailSchema.parse(
        await (await api(`/api/sessions/${session.id}`, { owner })).json(),
      );
      expect(d.messages.at(-1)?.content).toContain('**Chart check:**');
      expect(d.messages.at(-1)?.content).toContain(
        'Venus rules the 7th and 12th houses, not the 2nd.',
      );
    });
  });

  it('reports an upstream error when the model cannot be called', async () => {
    const owner = freshOwner();
    const { session } = await setup(owner);
    vi.spyOn(env.AI, 'run').mockRejectedValue(new Error('down'));
    const { events } = await ask(owner, session.id, 'Overview?');
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'AI_UPSTREAM_ERROR' } });
  });

  it('validates questions and blocks a second concurrent answer', async () => {
    const owner = freshOwner();
    const { session } = await setup(owner);
    for (const question of ['   ', 'x'.repeat(2001)]) {
      const res = await api(`/api/sessions/${session.id}/messages`, {
        method: 'POST',
        owner,
        json: { question },
      });
      expect(res.status).toBe(400);
    }
    await env.DB.prepare(
      "INSERT INTO qa_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'assistant', '', 'streaming', ?)",
    )
      .bind(crypto.randomUUID(), session.id, new Date().toISOString())
      .run();
    const res = await api(`/api/sessions/${session.id}/messages`, {
      method: 'POST',
      owner,
      json: { question: 'Hi' },
    });
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('ANSWER_IN_PROGRESS');
  });

  it('renames, changes language, deletes and isolates owners', async () => {
    const owner = freshOwner();
    const { profile, session } = await setup(owner);
    const patched = SessionResponseSchema.parse(
      await (
        await api(`/api/sessions/${session.id}`, {
          method: 'PATCH',
          owner,
          json: { title: 'Career', lang: 'te' },
        })
      ).json(),
    ).session;
    expect(patched).toMatchObject({ title: 'Career', lang: 'te' });

    const other = freshOwner();
    expect((await api(`/api/sessions/${session.id}`, { owner: other })).status).toBe(404);
    expect((await api(`/api/profiles/${profile.id}/sessions`, { owner: other })).status).toBe(404);
    expect(
      (
        await api(`/api/sessions/${session.id}/messages`, {
          method: 'POST',
          owner: other,
          json: { question: 'x' },
        })
      ).status,
    ).toBe(404);

    expect((await api(`/api/sessions/${session.id}`, { method: 'DELETE', owner })).status).toBe(
      200,
    );
    expect((await api(`/api/sessions/${session.id}`, { owner })).status).toBe(404);
  });

  it('flags sessions whose kundali is no longer the latest', async () => {
    const owner = freshOwner();
    const { profile, session } = await setup(owner);
    await api(`/api/profiles/${profile.id}`, { method: 'PATCH', owner, json: { tob: '15:00' } });
    const d = SessionDetailSchema.parse(
      await (await api(`/api/sessions/${session.id}`, { owner })).json(),
    );
    expect(d.kundaliOutdated).toBe(true);
  });

  it('tells the model when the birth time is unknown', async () => {
    const owner = freshOwner();
    const { session } = await setup(owner, { ...ARJUN, tobUnknown: true });
    const run = mockAi(() => modelStream(['ok']));
    await ask(owner, session.id, 'Overview?');
    const input = run.mock.calls[0]![1] as { messages: { content: string }[] };
    expect(input.messages[0]?.content).toContain('Time-uncertain: yes');
    expect(input.messages[0]?.content).toContain('TIME-UNCERTAIN');
  });
});

describe('follow-up questions', () => {
  it('streams and stores the answer without the follow-up block, and keeps the questions', async () => {
    const owner = freshOwner();
    const { session } = await setup(owner);
    mockAi(() =>
      modelStream([
        'Jupiter favours growth.',
        '\n<<<FOLL',
        'OWUPS\n- When does it peak?',
        '\n- What about career?',
      ]),
    );
    const { events } = await ask(owner, session.id, 'What does my current dasha indicate?');
    const streamed = events
      .filter((e) => e.event === 'token')
      .map((e) => e.data.text)
      .join('');
    expect(streamed).not.toContain('FOLLOWUPS');
    expect(streamed.trim()).toBe('Jupiter favours growth.');

    const d = SessionDetailSchema.parse(
      await (await api(`/api/sessions/${session.id}`, { owner })).json(),
    );
    expect(d.messages[1]).toMatchObject({
      content: 'Jupiter favours growth.',
      followups: ['When does it peak?', 'What about career?'],
    });
    expect(d.messages[0]?.followups).toEqual([]);
  });
});

describe('dropped connections and Stop', () => {
  const defaults = { ...streamTiming };
  afterEach(() => Object.assign(streamTiming, defaults));

  /** Reasoning chunks, then answer parts; waits on `gate` before part `pauseAt`. */
  function gatedStream(parts: string[], pauseAt: number, gate: Promise<void>) {
    const enc = new TextEncoder();
    const chunk = (delta: Record<string, string>) =>
      enc.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    let i = 0;
    return new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (i < 3) ctrl.enqueue(chunk({ reasoning_content: 'thinking…' }));
        else if (i - 3 < parts.length) {
          if (i - 3 === pauseAt) await gate;
          ctrl.enqueue(chunk({ content: parts[i - 3]! }));
        } else {
          ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
          ctrl.close();
        }
        i++;
      },
    });
  }

  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
    const dec = new TextDecoder();
    let text = '';
    while (!text.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    return text;
  }

  const answerRow = (sessionId: string) =>
    env.DB.prepare(
      "SELECT status, content FROM qa_messages WHERE session_id = ? AND role = 'assistant'",
    )
      .bind(sessionId)
      .first<{ status: string; content: string }>();

  it('keeps writing and saves the full answer when the connection drops', async () => {
    const owner = freshOwner();
    const { session } = await setup(owner);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockAi(() => gatedStream(['Married life ', 'is stable ', 'and warm.'], 1, gate));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 503 }));

    const res = await api(`/api/sessions/${session.id}/messages`, {
      method: 'POST',
      owner,
      json: { question: 'How will be my married life?' },
    });
    const reader = res.body!.getReader();
    await readUntil(reader, 'Married life');
    await reader.cancel(); // the phone dropped the connection
    release();

    await vi.waitFor(async () => expect((await answerRow(session.id))?.status).toBe('complete'), {
      timeout: 5000,
    });
    expect((await answerRow(session.id))?.content).toBe('Married life is stable and warm.');
  });

  it('Stop ends the answer, keeps what was written, and pings while thinking', async () => {
    Object.assign(streamTiming, { heartbeatMs: 0, saveEveryMs: 0 });
    const owner = freshOwner();
    const { session } = await setup(owner);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockAi(() => gatedStream(['Part one. ', 'Part two.'], 1, gate));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 503 }));

    const res = await api(`/api/sessions/${session.id}/messages`, {
      method: 'POST',
      owner,
      json: { question: 'What does my current dasha indicate?' },
    });
    const reader = res.body!.getReader();
    const head = await readUntil(reader, 'Part one.');
    expect(head).toContain(': ping');

    const stop = await api(`/api/sessions/${session.id}/stop`, { method: 'POST', owner });
    expect(await stop.json()).toEqual({ ok: true, stopping: true });
    release();
    await readUntil(reader, 'event: done');

    const row = await answerRow(session.id);
    expect(row).toEqual({ status: 'complete', content: `Part one.${STOPPED_NOTE}` });
  });
});
