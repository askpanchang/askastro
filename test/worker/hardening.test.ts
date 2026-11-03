import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import { ProfileResponseSchema } from '../../shared/profile';
import { createApp } from '../../worker/app';
import { accessKeys } from '../../worker/lib/owner';
import fixture from '../fixtures/askpanchang-sample.json';
import { ARJUN } from './helpers';

const TEAM = 'https://kundali.cloudflareaccess.com';
const AUD = 'test-aud-123';
const app = createApp();

async function call(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}) {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`https://studio.test${path}`, init),
    { ...env, ...overrides },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('Cloudflare Access verification', () => {
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;
  const realGet = accessKeys.get;
  const access = { ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM };
  const accessBase = access;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair('RS256')).privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
    accessKeys.get = () => createLocalJWKSet({ keys: [jwk] });
  });
  afterAll(() => {
    accessKeys.get = realGet;
  });

  const token = (
    claims: Record<string, unknown>,
    opts: { key?: CryptoKey; aud?: string; iss?: string; exp?: string } = {},
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.iss ?? TEAM)
      .setAudience(opts.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '10m')
      .sign(opts.key ?? privateKey);

  it('requires a token when ACCESS_AUD is set, but keeps /api/health public', async () => {
    expect((await call('/api/health', {}, access)).status).toBe(200);
    const res = await call('/api/profiles', {}, access);
    expect(res.status).toBe(401);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('ignores the spoofable email header once Access is configured', async () => {
    const res = await call(
      '/api/profiles',
      { headers: { 'cf-access-authenticated-user-email': 'eve@x.dev' } },
      access,
    );
    expect(res.status).toBe(401);
  });

  it.each([
    ['wrong audience', { aud: 'other' }],
    ['wrong issuer', { iss: 'https://evil.cloudflareaccess.com' }],
    ['wrong signing key', { key: undefined as unknown as CryptoKey, useOther: true }],
    ['expired', { exp: '-1m' }],
  ])('rejects a token with %s', async (_l, opts) => {
    const o = 'useOther' in opts ? { key: otherKey } : opts;
    const t = await token({ email: 'a@x.dev' }, o as never);
    const res = await call('/api/profiles', { headers: { 'cf-access-jwt-assertion': t } }, access);
    expect(res.status).toBe(401);
  });

  it('uses the verified email as owner (header or CF_Authorization cookie)', async () => {
    const email = `Owner-${crypto.randomUUID().slice(0, 6)}@Example.com`;
    const t = await token({ email });
    // With Access on, only ADMIN_EMAILS may create profiles.
    const access = { ...accessBase, ADMIN_EMAILS: email.toLowerCase() };
    const created = await call(
      '/api/profiles',
      {
        method: 'POST',
        headers: { 'cf-access-jwt-assertion': t, 'content-type': 'application/json' },
        body: JSON.stringify(ARJUN),
      },
      access,
    );
    expect(created.status).toBe(201);
    const { profile } = ProfileResponseSchema.parse(await created.json());
    const row = await env.DB.prepare('SELECT owner_id FROM profiles WHERE id = ?')
      .bind(profile.id)
      .first();
    expect(row).toEqual({ owner_id: email.toLowerCase() });

    const viaCookie = await call(
      `/api/profiles/${profile.id}`,
      { headers: { cookie: `foo=1; CF_Authorization=${t}` } },
      access,
    );
    expect(viaCookie.status).toBe(200);

    const other = await token({ email: 'someone-else@example.com' });
    expect(
      (
        await call(
          `/api/profiles/${profile.id}`,
          { headers: { 'cf-access-jwt-assertion': other } },
          access,
        )
      ).status,
    ).toBe(404);
  });

  it('rejects tokens without a user email (service tokens)', async () => {
    const t = await token({ common_name: 'svc' });
    expect(
      (await call('/api/profiles', { headers: { 'cf-access-jwt-assertion': t } }, access)).status,
    ).toBe(403);
  });

  it('fails closed when the team domain is missing', async () => {
    const res = await call('/api/profiles', {}, { ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: '' });
    expect(res.status).toBe(500);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('AUTH_MISCONFIGURED');
  });
});

describe('rate limits', () => {
  it('limits kundali generation per owner per hour', async () => {
    const owner = `rl-${crypto.randomUUID()}@x.dev`;
    const headers = {
      'cf-access-authenticated-user-email': owner,
      'content-type': 'application/json',
    };
    const limits = { RATE_LIMIT_KUNDALIS_PER_HOUR: '1' };
    const { profile } = ProfileResponseSchema.parse(
      await (
        await call(
          '/api/profiles',
          { method: 'POST', headers, body: JSON.stringify(ARJUN) },
          limits,
        )
      ).json(),
    );
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(fixture)));
    expect(
      (await call(`/api/profiles/${profile.id}/kundali`, { method: 'POST', headers }, limits))
        .status,
    ).toBe(201);
    const res = await call(
      `/api/profiles/${profile.id}/kundali`,
      { method: 'POST', headers },
      limits,
    );
    // Upstream was called only once: the limit is checked before calling it.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(res.status).toBe(429);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('RATE_LIMITED');
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(3500);
    expect(retry).toBeLessThanOrEqual(3600);
  });

  it('limits questions per owner per hour', async () => {
    const owner = `rlq-${crypto.randomUUID()}@x.dev`;
    const headers = {
      'cf-access-authenticated-user-email': owner,
      'content-type': 'application/json',
    };
    const limits = { RATE_LIMIT_QUESTIONS_PER_HOUR: '1' };
    const { profile } = ProfileResponseSchema.parse(
      await (
        await call('/api/profiles', { method: 'POST', headers, body: JSON.stringify(ARJUN) })
      ).json(),
    );
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(fixture)));
    await call(`/api/profiles/${profile.id}/kundali`, { method: 'POST', headers });
    spy.mockRestore();
    const sres = await call(`/api/profiles/${profile.id}/sessions`, { method: 'POST', headers });
    const { session } = (await sres.json()) as { session: { id: string } };
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
    // Streaming: read the body before waiting on the waitUntil work that writes it.
    const ask = async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request(`https://studio.test/api/sessions/${session.id}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ question: 'Hi?' }),
        }),
        { ...env, ...limits },
        ctx,
      );
      await res.text();
      await waitOnExecutionContext(ctx);
      return res;
    };
    const first = await ask();
    expect(first.status).toBe(200);
    const second = await ask();
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe('API hardening', () => {
  it('sets security headers and no-store on API responses', async () => {
    const res = await call('/api/profiles');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    // Error responses too.
    expect((await call('/api/nope')).headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects cross-site writes but allows same-origin ones', async () => {
    const body = JSON.stringify(ARJUN);
    const evil = await call('/api/profiles', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body,
    });
    expect(evil.status).toBe(403);
    expect(ApiErrorSchema.parse(await evil.json()).error.code).toBe('CROSS_ORIGIN');
    const fetchSite = await call('/api/profiles', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
      body,
    });
    expect(fetchSite.status).toBe(403);
    const same = await call('/api/profiles', {
      method: 'POST',
      headers: {
        origin: 'https://studio.test',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      body,
    });
    expect(same.status).toBe(201);
    // Reads are unaffected.
    expect(
      (await call('/api/profiles', { headers: { origin: 'https://evil.example' } })).status,
    ).toBe(200);
  });
});
