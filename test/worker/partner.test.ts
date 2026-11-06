import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import { ProfileResponseSchema } from '../../shared/profile';
import { SessionDetailSchema, SessionResponseSchema } from '../../shared/session';
import fixture from '../fixtures/askpanchang-sample.json';
import match from '../fixtures/matchmaking-sample.json';
import { ARJUN, api, freshOwner } from './helpers';

afterEach(() => vi.restoreAllMocks());

const PRIYA = {
  ...ARJUN,
  name: 'Priya Natarajan',
  gender: 'f',
  dob: '1994-03-12',
  tob: '06:20',
  place: 'Chennai, Tamil Nadu, India',
  lat: 13.0827,
  lon: 80.2707,
} as const;

/** Upstream: kundali generation, matchmaking; transits fail fast. */
function mockUpstream() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/kundali/generate')) return new Response(JSON.stringify(fixture));
    if (url.includes('/matchmaking/analyze')) return new Response(JSON.stringify(match));
    return new Response('no', { status: 503 });
  });
}

async function profile(owner: string, body: object, withKundali = true) {
  const { profile: p } = ProfileResponseSchema.parse(
    await (await api('/api/profiles', { method: 'POST', owner, json: body })).json(),
  );
  if (withKundali) await api(`/api/profiles/${p.id}/kundali`, { method: 'POST', owner });
  return p;
}

async function newSession(owner: string, profileId: string) {
  return SessionResponseSchema.parse(
    await (await api(`/api/profiles/${profileId}/sessions`, { method: 'POST', owner })).json(),
  ).session;
}

const setPartner = (owner: string, sessionId: string, json: object) =>
  api(`/api/sessions/${sessionId}/partner`, { method: 'PUT', owner, json });

describe('second person in a session', () => {
  it('adds, validates and removes the second person', async () => {
    mockUpstream();
    const owner = freshOwner();
    const arjun = await profile(owner, ARJUN);
    const priya = await profile(owner, PRIYA);
    const noChart = await profile(owner, { ...PRIYA, name: 'No Chart' }, false);
    const session = await newSession(owner, arjun.id);
    expect(session.partner).toBeNull();

    const same = await setPartner(owner, session.id, { profileId: arjun.id, relation: 'spouse' });
    expect(ApiErrorSchema.parse(await same.json()).error.code).toBe('SAME_PROFILE');

    const missing = await setPartner(owner, session.id, {
      profileId: noChart.id,
      relation: 'friend',
    });
    expect(missing.status).toBe(409);
    expect(ApiErrorSchema.parse(await missing.json()).error.message).toContain('No Chart');

    const bad = await setPartner(owner, session.id, { profileId: priya.id, relation: 'cousin' });
    expect(bad.status).toBe(400);

    const ok = await setPartner(owner, session.id, { profileId: priya.id, relation: 'spouse' });
    expect(ok.status).toBe(200);
    const { session: s } = SessionResponseSchema.parse(await ok.json());
    expect(s.partner).toMatchObject({
      profileId: priya.id,
      name: 'Priya Natarajan',
      relation: 'spouse',
    });

    // Someone else can't add a profile they can't read.
    const stranger = freshOwner();
    const theirs = await profile(stranger, ARJUN);
    const theirSession = await newSession(stranger, theirs.id);
    const denied = await setPartner(stranger, theirSession.id, {
      profileId: priya.id,
      relation: 'friend',
    });
    expect(denied.status).toBe(404);

    const removed = await api(`/api/sessions/${session.id}/partner`, { method: 'DELETE', owner });
    expect(SessionResponseSchema.parse(await removed.json()).session.partner).toBeNull();
  });

  it('hides the second person once their profile is no longer shared', async () => {
    mockUpstream();
    const owner = freshOwner();
    const kid = freshOwner();
    const arjun = await profile(owner, ARJUN);
    const priya = await profile(owner, PRIYA);
    for (const p of [arjun, priya])
      await api(`/api/profiles/${p.id}/shares`, { method: 'POST', owner, json: { email: kid } });
    const session = await newSession(kid, arjun.id);
    expect(
      (await setPartner(kid, session.id, { profileId: priya.id, relation: 'sibling' })).status,
    ).toBe(200);

    await api(`/api/profiles/${priya.id}/shares/${encodeURIComponent(kid)}`, {
      method: 'DELETE',
      owner,
    });
    const d = SessionDetailSchema.parse(
      await (await api(`/api/sessions/${session.id}`, { owner: kid })).json(),
    );
    expect(d.session.partner).toBeNull();
  });

  it('answers with both charts and the Guna Milan for a couple', async () => {
    mockUpstream();
    const owner = freshOwner();
    const arjun = await profile(owner, ARJUN);
    const priya = await profile(owner, PRIYA);
    const session = await newSession(owner, arjun.id);
    await setPartner(owner, session.id, { profileId: priya.id, relation: 'spouse' });

    const enc = new TextEncoder();
    const run = vi.spyOn(env.AI, 'run').mockImplementation(
      (async () =>
        new ReadableStream({
          start(c) {
            c.enqueue(
              enc.encode(
                'data: {"choices":[{"delta":{"content":"Arjun and Priya match well."}}]}\n\n',
              ),
            );
            c.enqueue(enc.encode('data: [DONE]\n\n'));
            c.close();
          },
        })) as unknown as typeof env.AI.run,
    );

    const res = await api(`/api/sessions/${session.id}/messages`, {
      method: 'POST',
      owner,
      json: { question: 'How will our married life be?' },
    });
    expect(await res.text()).toContain('event: done');

    const [, input] = run.mock.calls[0]! as unknown as [
      string,
      { messages: { content: string }[] },
    ];
    const system = input.messages[0]!.content;
    expect(system).toContain('TWO PEOPLE');
    expect(system).toContain('===== PERSON 1: Arjun Sharma =====');
    expect(system).toContain("===== PERSON 2: Priya Natarajan (Arjun's spouse) =====");
    expect(system).toContain('Total: 31.5/36 (Uttam Milan)');
    // The API's Boy/Girl labels are replaced by names.
    expect(system).toMatch(/- Manglik Dosha: Arjun .* Priya /);
    expect(system).not.toMatch(/\bBoy\b|\bGirl\b/);
  });
});
