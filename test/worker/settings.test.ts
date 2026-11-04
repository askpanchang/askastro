import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import { ModelChoiceSchema } from '../../shared/models';
import { ProfileResponseSchema } from '../../shared/profile';
import { SessionResponseSchema } from '../../shared/session';
import { createApp } from '../../worker/app';
import fixture from '../fixtures/askpanchang-sample.json';
import { ARJUN } from './helpers';

const app = createApp();
const DEEPSEEK = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
const GLM = '@cf/zai-org/glm-5.3-flash';
const GPT = '@cf/openai/gpt-oss-120b';

afterEach(() => vi.restoreAllMocks());

const tag = crypto.randomUUID().slice(0, 8);
const admin = `admin-${tag}@x.dev`;
const member = `member-${tag}@x.dev`;
const overrides: Partial<Env> = { ADMIN_EMAILS: admin, AI_MODEL: DEEPSEEK };

async function as(who: string, path: string, init: { method?: string; json?: unknown } = {}) {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = { 'cf-access-authenticated-user-email': who };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(
    new Request(`https://studio.test${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    }),
    { ...env, ...overrides },
    ctx,
  );
  const text = await res.text(); // read SSE bodies before waiting (see CLAUDE.md)
  await waitOnExecutionContext(ctx);
  return { res, json: () => JSON.parse(text) as unknown };
}

function okStream() {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Answer."}}]}\n\n'));
      c.enqueue(
        enc.encode('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":10}}\n\n'),
      );
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
}

describe('/api/settings/model', () => {
  it('is admin-only', async () => {
    for (const [method, json] of [
      ['GET', undefined],
      ['PUT', { model: GLM }],
    ] as const) {
      const r = await as(member, '/api/settings/model', { method, json });
      expect(r.res.status).toBe(403);
      expect(ApiErrorSchema.parse(r.json()).error.code).toBe('ADMIN_ONLY');
    }
  });

  it('defaults to AI_MODEL, rejects unknown models and saves a pick', async () => {
    const first = ModelChoiceSchema.parse((await as(admin, '/api/settings/model')).json());
    expect(first).toMatchObject({ model: DEEPSEEK, defaultModel: DEEPSEEK, updatedBy: null });
    expect(first.options.map((o) => [o.id, o.billing])).toEqual([
      [DEEPSEEK, 'credits'],
      [GLM, 'credits'],
      [GPT, 'free'],
    ]);

    const bad = await as(admin, '/api/settings/model', {
      method: 'PUT',
      json: { model: '@cf/moonshotai/kimi-k2.6' },
    });
    expect(bad.res.status).toBe(400);

    const saved = ModelChoiceSchema.parse(
      (await as(admin, '/api/settings/model', { method: 'PUT', json: { model: GLM } })).json(),
    );
    expect(saved).toMatchObject({ model: GLM, defaultModel: DEEPSEEK, updatedBy: admin });
    expect(saved.updatedAt).not.toBeNull();
  });

  it('answers with the picked model: paid ones via the gateway, free ones directly', async () => {
    const { profile } = ProfileResponseSchema.parse(
      (await as(admin, '/api/profiles', { method: 'POST', json: ARJUN })).json(),
    );
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(fixture)));
    await as(admin, `/api/profiles/${profile.id}/kundali`, { method: 'POST' });
    fetchSpy.mockRestore();
    // Transit lookups fail fast (no network in tests); answers proceed without them.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const run = vi
      .spyOn(env.AI, 'run')
      .mockImplementation((async () => okStream()) as unknown as typeof env.AI.run);

    const ask = async (model: string) => {
      await as(admin, '/api/settings/model', { method: 'PUT', json: { model } });
      const { session } = SessionResponseSchema.parse(
        (await as(admin, `/api/profiles/${profile.id}/sessions`, { method: 'POST' })).json(),
      );
      expect(session.model).toBe(model);
      const r = await as(admin, `/api/sessions/${session.id}/messages`, {
        method: 'POST',
        json: { question: 'How is my career?' },
      });
      expect(r.res.status).toBe(200);
      return session.id;
    };

    const glmSession = await ask(GLM);
    expect(run.mock.calls.at(-1)?.[0]).toBe(GLM);
    expect(run.mock.calls.at(-1)?.[2]).toEqual({ gateway: { id: env.AI_GATEWAY_ID } });

    await ask(GPT);
    expect(run.mock.calls.at(-1)?.[0]).toBe(GPT);
    expect(run.mock.calls.at(-1)?.[2]).toEqual({});

    // Each answer records the model that wrote it.
    const row = await env.DB.prepare(
      "SELECT model FROM qa_messages WHERE session_id = ? AND role = 'assistant'",
    )
      .bind(glmSession)
      .first<{ model: string }>();
    expect(row?.model).toBe(GLM);
  });
});
