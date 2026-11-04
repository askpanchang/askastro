import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sseEvent } from '../../shared/sse';
import fixture from '../fixtures/askpanchang-sample.json';
import { PROFILE, mockApi, renderApp } from './renderApp';

afterEach(() => vi.unstubAllGlobals());

const SESSION = {
  id: '33333333-3333-4333-8333-333333333333',
  profileId: PROFILE.id,
  kundaliId: '22222222-2222-4222-8222-222222222222',
  title: 'New session',
  model: '@cf/openai/gpt-oss-120b',
  lang: 'en',
  messageCount: 0,
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
};
const msg = (role: string, content: string, i: number) => ({
  id: `m${i}`,
  role,
  content,
  status: 'complete',
  tokensIn: null,
  tokensOut: null,
  createdAt: `2026-11-03T10:00:0${i}.000Z`,
});

describe('session page', () => {
  it('streams tokens into the thread, then shows the stored answer', async () => {
    let stored: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi({
      [`GET /api/sessions/${SESSION.id}`]: () =>
        Response.json({ session: SESSION, messages: stored, kundaliOutdated: false }),
      [`GET /api/profiles/${PROFILE.id}`]: () =>
        Response.json({ profile: PROFILE, latestKundali: null, access: 'owner', sharedBy: null }),
      [`GET /api/kundali/${SESSION.kundaliId}`]: () =>
        Response.json({
          kundali: {
            id: SESSION.kundaliId,
            profileId: PROFILE.id,
            ayanamsa: 'lahiri',
            chartStyle: 'north',
            lang: 'en',
            timeUncertain: false,
            stale: false,
            createdAt: SESSION.createdAt,
            data: fixture,
            digest: '',
          },
        }),
      [`POST /api/sessions/${SESSION.id}/messages`]: (_u, init) => {
        const { question } = JSON.parse(String(init.body)) as { question: string };
        const enc = new TextEncoder();
        const body = new ReadableStream({
          async start(c) {
            c.enqueue(enc.encode(sseEvent('start', { userMessageId: 'u', messageId: 'a' })));
            c.enqueue(enc.encode(sseEvent('token', { text: '**Jupiter** ' })));
            await gate;
            c.enqueue(enc.encode(sseEvent('token', { text: 'brings growth.' })));
            stored = [msg('user', question, 1), msg('assistant', '**Jupiter** brings growth.', 2)];
            c.enqueue(enc.encode(sseEvent('done', { messageId: 'a', tokensIn: 1, tokensOut: 2 })));
            c.close();
          },
        });
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    renderApp(`/sessions/${SESSION.id}`);

    // The session page is a lazy route: allow for a slow first load on CI.
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'What does my current dasha indicate?' },
        { timeout: 5000 },
      ),
    );
    // First token is rendered as Markdown while streaming; input is locked.
    expect(await screen.findByText('Jupiter', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ask a question about this chart')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop answer' })).toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.getByText(/brings growth\./)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument());
    expect(screen.getAllByText('What does my current dasha indicate?')).toHaveLength(1);
    expect(screen.getByLabelText('Ask a question about this chart')).not.toBeDisabled();
  });

  it('sends with Enter but not Shift+Enter', async () => {
    const fetch = mockApi({
      [`GET /api/sessions/${SESSION.id}`]: () =>
        Response.json({ session: SESSION, messages: [], kundaliOutdated: true }),
      [`GET /api/profiles/${PROFILE.id}`]: () =>
        Response.json({ profile: PROFILE, latestKundali: null, access: 'owner', sharedBy: null }),
      [`POST /api/sessions/${SESSION.id}/messages`]: () =>
        Response.json(
          {
            error: {
              code: 'ANSWER_IN_PROGRESS',
              message: 'Wait for the current answer to finish.',
            },
          },
          { status: 409 },
        ),
    });
    renderApp(`/sessions/${SESSION.id}`);
    expect(await screen.findByText(/tied to an earlier kundali/)).toBeInTheDocument();
    const box = screen.getByLabelText('Ask a question about this chart');
    fireEvent.change(box, { target: { value: 'Career?' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(
      fetch.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false);
    fireEvent.keyDown(box, { key: 'Enter' });
    // Rejected before storage: the question goes back into the box.
    expect(await screen.findByText('Wait for the current answer to finish.')).toBeInTheDocument();
    expect(box).toHaveValue('Career?');
  });
});
