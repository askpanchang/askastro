import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from './renderApp';

afterEach(() => vi.unstubAllGlobals());

const base = {
  day: '2026-11-04',
  resetsAt: new Date(Date.now() + 3 * 3600_000 + 12 * 60_000).toISOString(),
  budget: 10_000,
  userLimit: 5_000,
  memberLimit: 5_000,
  you: { neurons: 4_100, questions: 12 },
  account: { neurons: 6_000, source: 'cloudflare' },
};

describe('usage page', () => {
  it('shows your share, the app total and the reset countdown', async () => {
    mockApi({
      'GET /api/me': () => Response.json({ email: 'kid@example.com', isAdmin: false }),
      'GET /api/usage': () => Response.json(base),
    });
    renderApp('/usage');
    expect(await screen.findByRole('progressbar', { name: 'Your AI use today' })).toHaveAttribute(
      'aria-valuenow',
      '82',
    );
    // The app-wide meter is for admins only.
    expect(
      screen.queryByRole('progressbar', { name: 'Whole app today (free allowance)' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Resets in 3 h 1[12] min/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Today by person' })).not.toBeInTheDocument();
    // Header pill warns at 80%+.
    expect(
      screen.getByRole('link', { name: 'AI usage: 82% of your daily allowance' }),
    ).toBeInTheDocument();
  });

  it('shows admins the per-person table and 7-day history', async () => {
    mockApi({
      'GET /api/usage': () =>
        Response.json({
          ...base,
          userLimit: null,
          people: [
            { email: 'admin@example.com', neurons: 1_900, questions: 6, limit: null },
            { email: 'kid@example.com', neurons: 4_100, questions: 12, limit: 5_000 },
          ],
          history: Array.from({ length: 7 }, (_, i) => ({
            day: `2026-10-${29 + i > 31 ? '0' : ''}${29 + i > 31 ? i - 2 : 29 + i}`.replace(
              '2026-10-0',
              '2026-11-0',
            ),
            appNeurons: 500 * i,
            accountNeurons: 600 * i,
          })),
        }),
    });
    renderApp('/usage');
    expect(await screen.findByRole('heading', { name: 'Today by person' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'kid@example.com' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Last 7 days' })).toBeInTheDocument();
    expect(screen.getByText(/no daily cap/)).toBeInTheDocument();
    expect(
      screen.queryByRole('progressbar', { name: 'Your AI use today' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Whole app today (free allowance)' }),
    ).toHaveAttribute('aria-valuenow', '60');
    // Admin's header pill shows the whole app against the free allowance.
    expect(
      screen.getByRole('link', { name: 'AI usage: 60% of the free daily allowance (app total)' }),
    ).toBeInTheDocument();
  });
});
