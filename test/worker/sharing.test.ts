import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import {
  MeSchema,
  ProfileDetailSchema,
  ProfileListSchema,
  ProfileResponseSchema,
  ShareListSchema,
} from '../../shared/profile';
import {
  SessionDetailSchema,
  SessionListSchema,
  SessionResponseSchema,
} from '../../shared/session';
import { createApp } from '../../worker/app';
import fixture from '../fixtures/askpanchang-sample.json';
import { ARJUN } from './helpers';

const app = createApp();

/** Each test gets its own admin and family emails, with ADMIN_EMAILS set. */
function people() {
  const tag = crypto.randomUUID().slice(0, 8);
  return { admin: `admin-${tag}@x.dev`, kid: `kid-${tag}@x.dev`, stranger: `other-${tag}@x.dev` };
}

async function as(
  who: string,
  admins: string,
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
    { ...env, ADMIN_EMAILS: admins, ...init.overrides },
    ctx,
  );
  // Streaming responses must be read before waiting on waitUntil work.
  const text = await res.text();
  await waitOnExecutionContext(ctx);
  return { res, text, json: () => JSON.parse(text) as unknown };
}

function mockAi() {
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
}

async function setup() {
  const p = people();
  const created = await as(p.admin, p.admin, '/api/profiles', { method: 'POST', json: ARJUN });
  expect(created.res.status).toBe(201);
  const { profile } = ProfileResponseSchema.parse(created.json());
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(fixture)));
  expect(
    (await as(p.admin, p.admin, `/api/profiles/${profile.id}/kundali`, { method: 'POST' })).res
      .status,
  ).toBe(201);
  spy.mockRestore();
  return { ...p, profileId: profile.id };
}

afterEach(() => vi.restoreAllMocks());

describe('roles', () => {
  it('reports who you are and whether you are an admin', async () => {
    const p = people();
    expect(MeSchema.parse((await as(p.admin, p.admin, '/api/me')).json())).toEqual({
      email: p.admin,
      isAdmin: true,
    });
    expect(MeSchema.parse((await as(p.kid, p.admin, '/api/me')).json())).toEqual({
      email: p.kid,
      isAdmin: false,
    });
  });

  it('only lets admins create profiles', async () => {
    const p = people();
    const res = await as(p.kid, p.admin, '/api/profiles', { method: 'POST', json: ARJUN });
    expect(res.res.status).toBe(403);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('ADMIN_ONLY');
  });

  it('fails closed when Access is on but ADMIN_EMAILS is empty', async () => {
    const { isAdminUser } = await import('../../worker/lib/owner');
    expect(isAdminUser({ ADMIN_EMAILS: '', ACCESS_AUD: 'aud' }, 'a@x.dev')).toBe(false);
    expect(isAdminUser({ ADMIN_EMAILS: '', ACCESS_AUD: '' }, 'a@x.dev')).toBe(true);
    expect(isAdminUser({ ADMIN_EMAILS: ' A@x.dev , b@x.dev', ACCESS_AUD: 'aud' }, 'a@x.dev')).toBe(
      true,
    );
  });
});

describe('profile sharing', () => {
  it('shares view + Q&A access with one person only', async () => {
    const { admin, kid, stranger, profileId } = await setup();

    // Before sharing: invisible to the family member.
    expect((await as(kid, admin, `/api/profiles/${profileId}`)).res.status).toBe(404);
    expect(
      ProfileListSchema.parse((await as(kid, admin, '/api/profiles')).json()).items,
    ).toHaveLength(0);

    const shared = await as(admin, admin, `/api/profiles/${profileId}/shares`, {
      method: 'POST',
      json: { email: `  ${kid.toUpperCase()} ` },
    });
    expect(shared.res.status).toBe(201);
    expect(ShareListSchema.parse(shared.json()).items.map((s) => s.email)).toEqual([kid]);

    const list = ProfileListSchema.parse((await as(kid, admin, '/api/profiles')).json());
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: profileId,
      access: 'shared',
      sharedBy: admin,
      kundaliStatus: 'current',
    });
    const detail = ProfileDetailSchema.parse(
      (await as(kid, admin, `/api/profiles/${profileId}`)).json(),
    );
    expect(detail).toMatchObject({ access: 'shared', sharedBy: admin });
    expect(detail.latestKundali).not.toBeNull();
    expect((await as(kid, admin, `/api/kundali/${detail.latestKundali!.id}`)).res.status).toBe(200);
    expect((await as(kid, admin, `/api/profiles/${profileId}/kundali`)).res.status).toBe(200);

    // Owner-only actions are refused.
    for (const [method, path, json] of [
      ['PATCH', `/api/profiles/${profileId}`, { name: 'x' }],
      ['DELETE', `/api/profiles/${profileId}`, undefined],
      ['POST', `/api/profiles/${profileId}/kundali`, undefined],
      ['GET', `/api/profiles/${profileId}/shares`, undefined],
      ['POST', `/api/profiles/${profileId}/shares`, { email: stranger }],
    ] as const) {
      const r = await as(kid, admin, path, { method, json });
      expect(r.res.status, `${method} ${path}`).toBe(403);
      expect(ApiErrorSchema.parse(r.json()).error.code).toBe('NOT_PROFILE_OWNER');
    }

    // Someone else still sees nothing.
    expect((await as(stranger, admin, `/api/profiles/${profileId}`)).res.status).toBe(404);
  });

  it('keeps Q&A sessions private to whoever created them', async () => {
    const { admin, kid, profileId } = await setup();
    await as(admin, admin, `/api/profiles/${profileId}/shares`, {
      method: 'POST',
      json: { email: kid },
    });
    mockAi();

    const mine = SessionResponseSchema.parse(
      (await as(admin, admin, `/api/profiles/${profileId}/sessions`, { method: 'POST' })).json(),
    ).session;
    const theirs = SessionResponseSchema.parse(
      (await as(kid, admin, `/api/profiles/${profileId}/sessions`, { method: 'POST' })).json(),
    ).session;
    const asked = await as(kid, admin, `/api/sessions/${theirs.id}/messages`, {
      method: 'POST',
      json: { question: 'Career?' },
    });
    expect(asked.res.status).toBe(200);

    const kidList = SessionListSchema.parse(
      (await as(kid, admin, `/api/profiles/${profileId}/sessions`)).json(),
    );
    expect(kidList.items.map((s) => s.id)).toEqual([theirs.id]);
    const adminList = SessionListSchema.parse(
      (await as(admin, admin, `/api/profiles/${profileId}/sessions`)).json(),
    );
    expect(adminList.items.map((s) => s.id)).toEqual([mine.id]);
    expect((await as(admin, admin, `/api/sessions/${theirs.id}`)).res.status).toBe(404);
    expect((await as(kid, admin, `/api/sessions/${mine.id}`)).res.status).toBe(404);
    const d = SessionDetailSchema.parse(
      (await as(kid, admin, `/api/sessions/${theirs.id}`)).json(),
    );
    expect(d.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    // Last Q&A activity in the list is per person.
    const adminProfiles = ProfileListSchema.parse((await as(admin, admin, '/api/profiles')).json());
    expect(adminProfiles.items[0]?.lastSessionAt).toBe(mine.updatedAt);
  });

  it('revoking a share removes access to the profile and the family member’s sessions', async () => {
    const { admin, kid, profileId } = await setup();
    await as(admin, admin, `/api/profiles/${profileId}/shares`, {
      method: 'POST',
      json: { email: kid },
    });
    const s = SessionResponseSchema.parse(
      (await as(kid, admin, `/api/profiles/${profileId}/sessions`, { method: 'POST' })).json(),
    ).session;

    const removed = await as(
      admin,
      admin,
      `/api/profiles/${profileId}/shares/${encodeURIComponent(kid)}`,
      {
        method: 'DELETE',
      },
    );
    expect(ShareListSchema.parse(removed.json()).items).toEqual([]);
    expect((await as(kid, admin, `/api/profiles/${profileId}`)).res.status).toBe(404);
    expect((await as(kid, admin, `/api/sessions/${s.id}`)).res.status).toBe(404);
  });

  it('validates share emails', async () => {
    const { admin, profileId } = await setup();
    for (const email of ['nope', '', admin]) {
      const r = await as(admin, admin, `/api/profiles/${profileId}/shares`, {
        method: 'POST',
        json: { email },
      });
      expect(r.res.status, email).toBe(400);
    }
  });

  it('gives family members their own, lower question limit', async () => {
    const { admin, kid, profileId } = await setup();
    await as(admin, admin, `/api/profiles/${profileId}/shares`, {
      method: 'POST',
      json: { email: kid },
    });
    mockAi();
    const overrides = {
      RATE_LIMIT_FAMILY_QUESTIONS_PER_HOUR: '1',
      RATE_LIMIT_QUESTIONS_PER_HOUR: '5',
    };
    const sid = SessionResponseSchema.parse(
      (await as(kid, admin, `/api/profiles/${profileId}/sessions`, { method: 'POST' })).json(),
    ).session.id;
    const ask = () =>
      as(kid, admin, `/api/sessions/${sid}/messages`, {
        method: 'POST',
        json: { question: 'Q?' },
        overrides,
      });
    expect((await ask()).res.status).toBe(200);
    expect((await ask()).res.status).toBe(429);

    // The admin's own allowance is separate and higher.
    const asid = SessionResponseSchema.parse(
      (await as(admin, admin, `/api/profiles/${profileId}/sessions`, { method: 'POST' })).json(),
    ).session.id;
    const adminAsk = () =>
      as(admin, admin, `/api/sessions/${asid}/messages`, {
        method: 'POST',
        json: { question: 'Q?' },
        overrides,
      });
    expect((await adminAsk()).res.status).toBe(200);
    expect((await adminAsk()).res.status).toBe(200);
  });
});
