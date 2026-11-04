import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import { ProfileResponseSchema } from '../../shared/profile';
import { SessionResponseSchema } from '../../shared/session';
import { UsageSchema, neuronsFor, utcDay } from '../../shared/usage';
import { createApp } from '../../worker/app';
import { analytics } from '../../worker/services/aiUsage';
import fixture from '../fixtures/askpanchang-sample.json';
import { ARJUN } from './helpers';

const app = createApp();

async function as(
  who: string,
  path: string,
  init: { method?: string; json?: unknown; overrides?: Partial<Env> } = {},
) {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = { 'cf-access-authenticated-user-email': who };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(
    new Request(`https://studio.test${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    }),
    { ...env, ...init.overrides },
    ctx,
  );
  const text = await res.text();
  await waitOnExecutionContext(ctx);
  return { res, text, json: () => JSON.parse(text) as unknown };
}

/** An admin with a profile, a kundali and an empty session. Unique per test. */
async function setup() {
  const tag = crypto.randomUUID().slice(0, 8);
  const admin = `admin-${tag}@x.dev`;
  const kid = `kid-${tag}@x.dev`;
  const overrides: Partial<Env> = {
    ADMIN_EMAILS: admin,
    // Unique account id so cached analytics never leak between tests.
    CF_ACCOUNT_ID: `acct-${tag}`,
    CF_ANALYTICS_TOKEN: '',
  };
  const { profile } = ProfileResponseSchema.parse(
    (await as(admin, '/api/profiles', { method: 'POST', json: ARJUN, overrides })).json(),
  );
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(fixture)));
  await as(admin, `/api/profiles/${profile.id}/kundali`, { method: 'POST', overrides });
  spy.mockRestore();
  await as(admin, `/api/profiles/${profile.id}/shares`, {
    method: 'POST',
    json: { email: kid },
    overrides,
  });
  const session = (who: string) =>
    as(who, `/api/profiles/${profile.id}/sessions`, { method: 'POST', overrides }).then(
      (r) => SessionResponseSchema.parse(r.json()).session,
    );
  return { admin, kid, overrides, profileId: profile.id, session };
}

/** Store one answered question with the given token counts, now. */
async function addAnswer(sessionId: string, tokensIn: number, tokensOut: number) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO qa_messages (id, session_id, role, content, status, created_at) VALUES (?, ?, 'user', 'Q', 'complete', ?)",
    ).bind(crypto.randomUUID(), sessionId, now),
    env.DB.prepare(
      "INSERT INTO qa_messages (id, session_id, role, content, status, tokens_in, tokens_out, created_at) VALUES (?, ?, 'assistant', 'A', 'complete', ?, ?, ?)",
    ).bind(crypto.randomUUID(), sessionId, tokensIn, tokensOut, now),
  ]);
}

afterEach(() => vi.restoreAllMocks());

describe('neuron maths', () => {
  it('uses Cloudflare’s per-model rates', () => {
    // The measured live answer: 2,415 in / 1,435 out ≈ 174.7 neurons.
    expect(neuronsFor('@cf/openai/gpt-oss-120b', 2415, 1435)).toBeCloseTo(174.7, 0);
    expect(neuronsFor('@cf/unknown/model', 1_000_000, 0)).toBe(31_818);
    expect(neuronsFor('dev:echo', 1e6, 1e6)).toBe(0);
  });

  it('resets at 00:00 UTC (5:30 AM IST)', () => {
    const d = utcDay(Date.parse('2026-11-04T23:59:00Z'));
    expect(d).toEqual({
      day: '2026-11-04',
      start: '2026-11-04T00:00:00.000Z',
      resetsAt: '2026-11-05T00:00:00.000Z',
    });
  });
});

describe('GET /api/usage', () => {
  it('shows each person their own usage; admins also see everyone and 7 days', async () => {
    const { admin, kid, overrides, session } = await setup();
    const kidSession = await session(kid);
    const adminSession = await session(admin);
    await addAnswer(kidSession.id, 2415, 1435); // ≈ 174.7
    await addAnswer(adminSession.id, 10_000, 5_000); // ≈ 659.1

    const mine = UsageSchema.parse((await as(kid, '/api/usage', { overrides })).json());
    expect(mine).toMatchObject({ budget: 10_000, userLimit: 5_000, you: { questions: 1 } });
    expect(mine.you.neurons).toBeCloseTo(174.7, 0);
    expect(mine.account.source).toBe('estimate');
    expect(mine.account.neurons).toBeGreaterThanOrEqual(833);
    expect(mine.people).toBeUndefined();
    expect(mine.history).toBeUndefined();

    const all = UsageSchema.parse((await as(admin, '/api/usage', { overrides })).json());
    expect(all.userLimit).toBeNull(); // admins have no app cap
    expect(all.memberLimit).toBe(5_000);
    expect(all.people?.find((p) => p.email === admin)?.limit).toBeNull();
    expect(all.people?.find((p) => p.email === kid)?.limit).toBe(5_000);
    expect(all.people?.map((p) => p.email).filter((e) => e === admin || e === kid)).toEqual([
      admin,
      kid,
    ]);
    expect(all.history).toHaveLength(7);
    expect(all.history?.at(-1)?.day).toBe(all.day);
  });

  it('reads the account-wide total from Cloudflare analytics when a token is set', async () => {
    const { kid, overrides } = await setup();
    const today = utcDay(Date.now()).day;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      expect(String(url)).toBe(analytics.endpoint);
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                aiInferenceAdaptiveGroups: [
                  { sum: { totalNeurons: 1200.5 }, dimensions: { date: today } },
                  { sum: { totalNeurons: 300 }, dimensions: { date: today } },
                ],
              },
            ],
          },
        },
      });
    });
    const withToken = { ...overrides, CF_ANALYTICS_TOKEN: 'read-only' };
    const u = UsageSchema.parse((await as(kid, '/api/usage', { overrides: withToken })).json());
    expect(u.account).toEqual({ neurons: 1500.5, source: 'cloudflare' });
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer read-only');
  });
});

describe('daily AI limits', () => {
  it('stops a person at their share of the daily budget', async () => {
    const { kid, overrides, session } = await setup();
    const s = await session(kid);
    await addAnswer(s.id, 100_000, 50_000); // ≈ 6,591 > 5,000
    const r = await as(kid, `/api/sessions/${s.id}/messages`, {
      method: 'POST',
      json: { question: 'More?' },
      overrides,
    });
    expect(r.res.status).toBe(429);
    const err = ApiErrorSchema.parse(r.json()).error;
    expect(err.code).toBe('DAILY_AI_LIMIT');
    expect(err.message).toContain('5:30 AM IST');
    const retry = Number(r.res.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(86_400);
  });

  it('never caps admins: they can use the whole allowance and any credits', async () => {
    const { admin, overrides, session } = await setup();
    const s = await session(admin);
    await addAnswer(s.id, 300_000, 100_000); // ≈ 16,363 neurons, over the whole free allowance
    const enc = new TextEncoder();
    vi.spyOn(env.AI, 'run').mockImplementation(
      (async () =>
        new ReadableStream({
          start(c) {
            c.enqueue(
              enc.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
            );
            c.close();
          },
        })) as unknown as typeof env.AI.run,
    );
    const r = await as(admin, `/api/sessions/${s.id}/messages`, {
      method: 'POST',
      json: { question: 'Still fine?' },
      overrides,
    });
    expect(r.res.status).toBe(200);
    expect(r.text).toContain('event: done');
  });

  it('turns Cloudflare’s "daily allocation used" error into a friendly message', async () => {
    const { kid, overrides, session } = await setup();
    const s = await session(kid);
    vi.spyOn(env.AI, 'run').mockRejectedValue(
      new Error('4006: you have used up your daily free allocation of 10,000 neurons'),
    );
    const r = await as(kid, `/api/sessions/${s.id}/messages`, {
      method: 'POST',
      json: { question: 'Hi?' },
      overrides,
    });
    expect(r.res.status).toBe(200); // the stream had started
    expect(r.text).toContain('event: error');
    expect(r.text).toContain('ACCOUNT_AI_LIMIT');
  });
});
