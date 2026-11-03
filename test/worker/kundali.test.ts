import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import { KundaliResponseSchema, KundaliVersionListSchema } from '../../shared/kundali';
import { ProfileResponseSchema } from '../../shared/profile';
import { AskPanchangClient } from '../../worker/services/askpanchang';
import fixture from '../fixtures/askpanchang-sample.json';
import { ARJUN, api, freshOwner } from './helpers';

const FIXTURE = JSON.stringify(fixture);

function mockUpstream(...responses: (() => Response)[]) {
  let i = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r!();
  });
}
const ok = () => new Response(FIXTURE, { headers: { 'content-type': 'application/json' } });

async function createProfile(owner: string, body: Record<string, unknown> = ARJUN) {
  const res = await api('/api/profiles', { method: 'POST', owner, json: body });
  return ProfileResponseSchema.parse(await res.json()).profile;
}

afterEach(() => vi.restoreAllMocks());

describe('POST /api/profiles/:id/kundali', () => {
  it('generates, stores the raw response and lists the version', async () => {
    const owner = freshOwner();
    const p = await createProfile(owner);
    const spy = mockUpstream(ok);

    const res = await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner });
    expect(res.status).toBe(201);
    const { kundali } = KundaliResponseSchema.parse(await res.json());
    expect(kundali).toMatchObject({
      profileId: p.id,
      ayanamsa: 'lahiri',
      chartStyle: 'north',
      lang: 'en',
      timeUncertain: false,
      stale: false,
    });
    expect(kundali.data.info.lagna).toBe(8);
    expect(kundali.digest).toContain('Lagna (ascendant): Scorpio (Vrischika) 26°28′');

    // Exact payload sent upstream.
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe(`${env.ASKPANCHANG_API_BASE}/api/v1/kundali/generate`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      bd: {
        nm: 'Arjun Sharma',
        g: 'm',
        dob: '1990-08-15',
        tob: '14:30',
        tz: 'Asia/Kolkata',
        lat: 17.385,
        lon: 78.4867,
        loc: 'Hyderabad, Telangana, India',
      },
      opt: { ayan: 'lahiri', chart: 'north', lang: 'en' },
    });

    const row = await env.DB.prepare(
      'SELECT response_json, request_json FROM kundalis WHERE id = ?',
    )
      .bind(kundali.id)
      .first<{ response_json: string; request_json: string }>();
    expect(row?.response_json).toBe(FIXTURE);

    const list = KundaliVersionListSchema.parse(
      await (await api(`/api/profiles/${p.id}/kundali`, { owner })).json(),
    );
    expect(list.items.map((v) => v.id)).toEqual([kundali.id]);

    const detail = KundaliResponseSchema.parse(
      await (await api(`/api/kundali/${kundali.id}`, { owner })).json(),
    );
    expect(detail.kundali.digest).toBe(kundali.digest);
  });

  it('casts unknown birth time for noon and marks it time-uncertain', async () => {
    const owner = freshOwner();
    const p = await createProfile(owner, { ...ARJUN, tobUnknown: true });
    const spy = mockUpstream(ok);
    const res = await api(`/api/profiles/${p.id}/kundali`, {
      method: 'POST',
      owner,
      json: { ayanamsa: 'raman', chartStyle: 'south', lang: 'te' },
    });
    const { kundali } = KundaliResponseSchema.parse(await res.json());
    expect(kundali.timeUncertain).toBe(true);
    expect(kundali.digest).toContain('TIME-UNCERTAIN');
    const body = JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body));
    expect(body.bd.tob).toBe('12:00');
    expect(body.opt).toEqual({ ayan: 'raman', chart: 'south', lang: 'te' });
  });

  it('rejects unsupported options without calling upstream', async () => {
    const owner = freshOwner();
    const p = await createProfile(owner);
    const spy = mockUpstream(ok);
    const res = await api(`/api/profiles/${p.id}/kundali`, {
      method: 'POST',
      owner,
      json: { ayanamsa: 'kp' },
    });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('retries once on 5xx, then reports an upstream error', async () => {
    const owner = freshOwner();
    const p = await createProfile(owner);
    const spy = mockUpstream(() => new Response('Internal Server Error', { status: 500 }));
    const res = await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner });
    expect(res.status).toBe(502);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('KUNDALI_UPSTREAM_ERROR');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('succeeds when the retry succeeds', async () => {
    const owner = freshOwner();
    const p = await createProfile(owner);
    mockUpstream(() => new Response('boom', { status: 503 }), ok);
    const res = await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner });
    expect(res.status).toBe(201);
  });

  it('maps 422 to KUNDALI_INVALID_INPUT and bad bodies to upstream errors', async () => {
    const owner = freshOwner();
    const p = await createProfile(owner);
    mockUpstream(() => Response.json({ detail: [] }, { status: 422 }));
    let res = await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner });
    expect(res.status).toBe(422);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('KUNDALI_INVALID_INPUT');

    vi.restoreAllMocks();
    mockUpstream(() => Response.json({ unexpected: true }));
    res = await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner });
    expect(res.status).toBe(502);
  });
});

describe('kundali access and staleness', () => {
  it("hides another owner's kundalis", async () => {
    const alice = freshOwner();
    const bob = freshOwner();
    const p = await createProfile(alice);
    mockUpstream(ok);
    const { kundali } = KundaliResponseSchema.parse(
      await (await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner: alice })).json(),
    );
    expect((await api(`/api/kundali/${kundali.id}`, { owner: bob })).status).toBe(404);
    expect((await api(`/api/profiles/${p.id}/kundali`, { owner: bob })).status).toBe(404);
    expect(
      (await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner: bob })).status,
    ).toBe(404);
  });

  it('marks versions stale after birth details change', async () => {
    const owner = freshOwner();
    const p = await createProfile(owner);
    mockUpstream(ok);
    await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner });
    await api(`/api/profiles/${p.id}`, { method: 'PATCH', owner, json: { tob: '14:45' } });
    const list = KundaliVersionListSchema.parse(
      await (await api(`/api/profiles/${p.id}/kundali`, { owner })).json(),
    );
    expect(list.items[0]?.stale).toBe(true);
  });
});

describe('AskPanchangClient', () => {
  it('sends the API key header only when a key is configured', async () => {
    const calls: Headers[] = [];
    const fetcher = (async (_u: unknown, init?: RequestInit) => {
      calls.push(new Headers(init?.headers));
      return ok();
    }) as typeof fetch;
    const base = { ASKPANCHANG_API_BASE: 'https://x.test/', ASKPANCHANG_API_KEY_HEADER: 'x-key' };
    const req = { bd: {}, opt: {} } as never;
    await new AskPanchangClient(base, fetcher).generate(req);
    await new AskPanchangClient({ ...base, ASKPANCHANG_API_KEY: 'secret' }, fetcher).generate(req);
    expect(calls[0]?.has('x-key')).toBe(false);
    expect(calls[1]?.get('x-key')).toBe('secret');
  });
});
