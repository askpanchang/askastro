import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import {
  ProfileDetailSchema,
  ProfileListSchema,
  ProfileResponseSchema,
} from '../../shared/profile';
import { chartInputHash } from '../../worker/lib/hash';
import { ARJUN, api, freshOwner } from './helpers';

async function create(owner: string, body: Record<string, unknown> = ARJUN) {
  const res = await api('/api/profiles', { method: 'POST', owner, json: body });
  expect(res.status).toBe(201);
  return ProfileResponseSchema.parse(await res.json()).profile;
}

describe('profiles CRUD', () => {
  it('creates, reads, updates and soft-deletes a profile', async () => {
    const owner = freshOwner();
    const created = await create(owner, { ...ARJUN, notes: '  first child  ' });
    expect(created).toMatchObject({ ...ARJUN, notes: 'first child' });

    const got = ProfileDetailSchema.parse(
      await (await api(`/api/profiles/${created.id}`, { owner })).json(),
    );
    expect(got.profile.id).toBe(created.id);
    expect(got.latestKundali).toBeNull();

    const patched = await api(`/api/profiles/${created.id}`, {
      method: 'PATCH',
      owner,
      json: { name: 'Arjun K. Sharma' },
    });
    expect(patched.status).toBe(200);
    const updated = ProfileResponseSchema.parse(await patched.json()).profile;
    expect(updated.name).toBe('Arjun K. Sharma');
    expect(updated.dob).toBe(ARJUN.dob);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);

    const del = await api(`/api/profiles/${created.id}`, { method: 'DELETE', owner });
    expect(await del.json()).toEqual({ ok: true });
    expect((await api(`/api/profiles/${created.id}`, { owner })).status).toBe(404);

    const row = await env.DB.prepare('SELECT deleted_at FROM profiles WHERE id = ?')
      .bind(created.id)
      .first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).toBeTruthy();
  });

  it('clears the time when it is marked unknown', async () => {
    const owner = freshOwner();
    const p = await create(owner, { ...ARJUN, tobUnknown: true });
    expect(p.tob).toBeNull();
    expect(p.tobUnknown).toBe(true);

    // Unmarking "unknown" without giving a time is rejected.
    const res = await api(`/api/profiles/${p.id}`, {
      method: 'PATCH',
      owner,
      json: { tobUnknown: false },
    });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(await res.json());
    expect(err.error.details).toMatchObject({ fieldErrors: { tob: [expect.any(String)] } });
  });
});

describe('profile validation', () => {
  it.each([
    ['missing name', { ...ARJUN, name: '  ' }, 'name'],
    ['bad gender', { ...ARJUN, gender: 'x' }, 'gender'],
    ['future date', { ...ARJUN, dob: '2999-01-01' }, 'dob'],
    ['impossible date', { ...ARJUN, dob: '1990-02-30' }, 'dob'],
    ['bad time', { ...ARJUN, tob: '25:00' }, 'tob'],
    ['missing time', { ...ARJUN, tob: null }, 'tob'],
    ['bad latitude', { ...ARJUN, lat: 91 }, 'lat'],
    ['bad time zone', { ...ARJUN, tz: 'Mars/Olympus' }, 'tz'],
  ])('rejects %s', async (_label, body, field) => {
    const res = await api('/api/profiles', { method: 'POST', owner: freshOwner(), json: body });
    expect(res.status).toBe(400);
    const err = ApiErrorSchema.parse(await res.json());
    expect(err.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys((err.error.details as { fieldErrors: object }).fieldErrors)).toContain(
      field,
    );
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const bad = await api('/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(ApiErrorSchema.parse(await bad.json()).error.code).toBe('INVALID_JSON');

    const big = await api('/api/profiles', {
      method: 'POST',
      json: { ...ARJUN, notes: 'x'.repeat(70_000) },
    });
    expect(big.status).toBe(413);
  });

  it('returns 404 for malformed and unknown ids', async () => {
    for (const id of ['nope', crypto.randomUUID()]) {
      const res = await api(`/api/profiles/${id}`);
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('PROFILE_NOT_FOUND');
    }
  });
});

describe('profile list', () => {
  it('searches by name and paginates newest first', async () => {
    const owner = freshOwner();
    for (const name of ['Asha Rao', 'Ravi Kumar', 'Ravindra Jain', 'Meera 100%_off']) {
      await create(owner, { ...ARJUN, name });
    }

    const page1 = ProfileListSchema.parse(
      await (await api('/api/profiles?limit=2', { owner })).json(),
    );
    expect(page1.items.map((p) => p.name)).toEqual(['Meera 100%_off', 'Ravindra Jain']);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = ProfileListSchema.parse(
      await (await api(`/api/profiles?limit=2&cursor=${page1.nextCursor}`, { owner })).json(),
    );
    expect(page2.items.map((p) => p.name)).toEqual(['Ravi Kumar', 'Asha Rao']);
    expect(page2.nextCursor).toBeNull();

    const search = ProfileListSchema.parse(
      await (await api('/api/profiles?q=ravi', { owner })).json(),
    );
    expect(search.items.map((p) => p.name).sort()).toEqual(['Ravi Kumar', 'Ravindra Jain']);

    // LIKE wildcards in the query are matched literally.
    const literal = ProfileListSchema.parse(
      await (await api('/api/profiles?q=%25_', { owner })).json(),
    );
    expect(literal.items.map((p) => p.name)).toEqual(['Meera 100%_off']);
  });

  it('rejects an invalid cursor', async () => {
    const res = await api('/api/profiles?cursor=%%%');
    expect(res.status).toBe(400);
  });
});

describe('owner isolation', () => {
  it("does not let one owner see or change another's profiles", async () => {
    const alice = freshOwner();
    const bob = freshOwner();
    const p = await create(alice);

    expect((await api(`/api/profiles/${p.id}`, { owner: bob })).status).toBe(404);
    expect(
      (await api(`/api/profiles/${p.id}`, { method: 'PATCH', owner: bob, json: { name: 'x' } }))
        .status,
    ).toBe(404);
    expect((await api(`/api/profiles/${p.id}`, { method: 'DELETE', owner: bob })).status).toBe(404);
    const list = ProfileListSchema.parse(await (await api('/api/profiles', { owner: bob })).json());
    expect(list.items).toHaveLength(0);
  });
});

describe('stale kundali detection', () => {
  it('flags the latest kundali as stale after birth data changes', async () => {
    const owner = freshOwner();
    const p = await create(owner);
    const opts = { ayanamsa: 'lahiri', chartStyle: 'north', lang: 'en' };
    const kid = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO kundalis (id, profile_id, ayanamsa, chart_style, lang, request_json, response_json, digest, input_hash, created_at)
       VALUES (?, ?, 'lahiri', 'north', 'en', '{}', '{}', '', ?, ?)`,
    )
      .bind(kid, p.id, await chartInputHash(p, opts), new Date().toISOString())
      .run();

    const fresh = ProfileDetailSchema.parse(
      await (await api(`/api/profiles/${p.id}`, { owner })).json(),
    );
    expect(fresh.latestKundali).toMatchObject({ id: kid, stale: false });

    // Renaming doesn't change the chart.
    await api(`/api/profiles/${p.id}`, { method: 'PATCH', owner, json: { name: 'A. Sharma' } });
    let list = ProfileListSchema.parse(await (await api('/api/profiles', { owner })).json());
    expect(list.items[0]?.kundaliStatus).toBe('current');

    await api(`/api/profiles/${p.id}`, { method: 'PATCH', owner, json: { tob: '14:45' } });
    const stale = ProfileDetailSchema.parse(
      await (await api(`/api/profiles/${p.id}`, { owner })).json(),
    );
    expect(stale.latestKundali?.stale).toBe(true);
    list = ProfileListSchema.parse(await (await api('/api/profiles', { owner })).json());
    expect(list.items[0]?.kundaliStatus).toBe('stale');
  });
});
