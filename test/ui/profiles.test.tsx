import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILE, mockApi, renderApp } from './renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** jsdom has no accessible names for closed <dialog>s, so find one by its heading text. */
function dialogWith(heading: string) {
  const d = screen
    .getAllByRole('dialog', { hidden: true })
    .find((el) => within(el).queryByText(heading));
  if (!d) throw new Error(`No dialog with "${heading}"`);
  return d;
}

const listOf = (items: unknown[], nextCursor: string | null = null) =>
  Response.json({ items, nextCursor });

describe('profiles list', () => {
  it('shows an empty state with a create link', async () => {
    mockApi({ 'GET /api/profiles': () => listOf([]) });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'No profiles yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create the first profile/ })).toHaveAttribute(
      'href',
      '/profiles/new',
    );
  });

  it('lists profiles with kundali status and loads more pages', async () => {
    const fetch = mockApi({
      'GET /api/profiles': (url) =>
        url.searchParams.get('cursor') === 'c1'
          ? listOf([
              {
                ...PROFILE,
                id: 'p2',
                name: 'Meera Iyer',
                kundaliStatus: 'stale',
                lastSessionAt: null,
                access: 'shared',
                sharedBy: 'owner@example.com',
              },
            ])
          : listOf(
              [
                {
                  ...PROFILE,
                  kundaliStatus: 'current',
                  lastSessionAt: null,
                  access: 'owner',
                  sharedBy: null,
                },
              ],
              'c1',
            ),
    });
    renderApp('/');
    const card = await screen.findByRole('link', { name: /Arjun Sharma/ });
    expect(within(card).getByText('Kundali ready')).toBeInTheDocument();
    expect(within(card).getByText(/15 Aug 1990 · 14:30 \(2:30 PM\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Meera Iyer')).toBeInTheDocument();
    expect(screen.getByText('Needs regenerating')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/profiles'))).toHaveLength(2);
  });

  it('shows an error state with retry', async () => {
    mockApi({ 'GET /api/profiles': () => new Response('boom', { status: 500 }) });
    renderApp('/');
    expect(await screen.findByText("Couldn't load profiles.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('profile form', () => {
  it('shows inline errors and does not submit an empty form', async () => {
    const fetch = mockApi({});
    renderApp('/profiles/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Create profile' }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Choose a gender')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid date')).toBeInTheDocument();
    expect(screen.getByText('Enter the time of birth or mark it unknown')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true');
    expect(
      fetch.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false);
  });

  it('rejects a future date of birth', async () => {
    mockApi({});
    renderApp('/profiles/new');
    fireEvent.change(await screen.findByLabelText('Date of birth'), {
      target: { value: '2999-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(await screen.findByText('Date of birth cannot be in the future')).toBeInTheDocument();
  });

  it('fills coordinates from place search and creates the profile', async () => {
    let posted: unknown;
    mockApi({
      'GET /api/geocode': () =>
        Response.json({
          results: [
            {
              id: '1',
              name: 'Hyderabad',
              admin1: 'Telangana',
              country: 'India',
              countryCode: 'IN',
              label: 'Hyderabad, Telangana, India',
              lat: 17.385,
              lon: 78.4867,
              tz: 'Asia/Kolkata',
            },
          ],
        }),
      'POST /api/profiles': (_u, init) => {
        posted = JSON.parse(String(init.body));
        return Response.json({ profile: PROFILE }, { status: 201 });
      },
      'GET /api/profiles/11111111-1111-4111-8111-111111111111': () =>
        Response.json({ profile: PROFILE, latestKundali: null, access: 'owner', sharedBy: null }),
    });
    const { router } = renderApp('/profiles/new');

    fireEvent.change(await screen.findByLabelText('Full name'), {
      target: { value: 'Arjun Sharma' },
    });
    fireEvent.click(screen.getByLabelText('Male'));
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-08-15' } });
    fireEvent.change(screen.getByLabelText('Time of birth'), {
      target: { value: '14:30' },
    });
    expect(screen.getByText('14:30 (24-hour) · 2:30 PM')).toBeInTheDocument();

    const place = screen.getByRole('combobox', { name: 'Place of birth' });
    fireEvent.focus(place);
    fireEvent.change(place, { target: { value: 'Hyder' } });
    fireEvent.click(await screen.findByRole('option', { name: /Hyderabad, Telangana, India/ }));
    expect(place).toHaveValue('Hyderabad, Telangana, India');
    expect(screen.getByLabelText('Time zone (IANA)')).toHaveValue('Asia/Kolkata');

    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    // Generous timeout: under the full parallel suite, save + navigate can exceed 1 s.
    await waitFor(() => expect(router.state.location.pathname).toBe(`/profiles/${PROFILE.id}`), {
      timeout: 5000,
    });
    expect(posted).toEqual({
      name: 'Arjun Sharma',
      gender: 'm',
      dob: '1990-08-15',
      tob: '14:30',
      tobUnknown: false,
      place: 'Hyderabad, Telangana, India',
      lat: 17.385,
      lon: 78.4867,
      tz: 'Asia/Kolkata',
      notes: null,
    });
    expect(await screen.findByText('Created Arjun Sharma')).toBeInTheDocument();
  });

  it('disables the time input when time is unknown', async () => {
    mockApi({});
    renderApp('/profiles/new');
    fireEvent.click(await screen.findByLabelText('Time of birth unknown'));
    expect(screen.getByLabelText('Time of birth')).toBeDisabled();
    expect(
      screen.getByText(/Ascendant and house-based readings will be unreliable/),
    ).toBeInTheDocument();
  });
});

describe('profile detail', () => {
  it('shows details and the stale banner', async () => {
    mockApi({
      [`GET /api/profiles/${PROFILE.id}`]: () =>
        Response.json({
          profile: PROFILE,
          latestKundali: {
            id: 'k1',
            ayanamsa: 'lahiri',
            chartStyle: 'north',
            lang: 'en',
            createdAt: '2026-11-01T10:00:00.000Z',
            stale: true,
          },
          access: 'owner',
          sharedBy: null,
        }),
    });
    renderApp(`/profiles/${PROFILE.id}?tab=details`);
    expect(await screen.findByRole('heading', { name: 'Arjun Sharma' })).toBeInTheDocument();
    expect(screen.getByText(/Birth details changed/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Asia/Kolkata')).toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    let deleted = false;
    mockApi({
      [`GET /api/profiles/${PROFILE.id}`]: () =>
        Response.json({ profile: PROFILE, latestKundali: null, access: 'owner', sharedBy: null }),
      [`DELETE /api/profiles/${PROFILE.id}`]: () => {
        deleted = true;
        return Response.json({ ok: true });
      },
      'GET /api/profiles': () => listOf([]),
    });
    const { router } = renderApp(`/profiles/${PROFILE.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    const dialog = dialogWith('Delete Arjun Sharma?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete profile', hidden: true }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(deleted).toBe(true);
  });
});

describe('shared profiles (family member)', () => {
  const FAMILY = () => Response.json({ email: 'kid@example.com', isAdmin: false });

  it('hides creation for non-admins and explains how to get access', async () => {
    mockApi({ 'GET /api/me': FAMILY, 'GET /api/profiles': () => listOf([]) });
    renderApp('/');
    expect(
      await screen.findByText(/No profiles have been shared with you yet/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New profile/ })).not.toBeInTheDocument();
  });

  it('shows a shared profile without owner controls', async () => {
    mockApi({
      'GET /api/me': FAMILY,
      [`GET /api/profiles/${PROFILE.id}`]: () =>
        Response.json({
          profile: PROFILE,
          latestKundali: null,
          access: 'shared',
          sharedBy: 'owner@example.com',
        }),
      [`GET /api/profiles/${PROFILE.id}/kundali`]: () => Response.json({ items: [] }),
    });
    renderApp(`/profiles/${PROFILE.id}`);
    expect(await screen.findByText('Shared with you by owner@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(await screen.findByText(/The owner hasn't generated/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate kundali' })).not.toBeInTheDocument();
  });

  it('lets the owner share a profile by email', async () => {
    let shares: { email: string; createdAt: string }[] = [];
    mockApi({
      [`GET /api/profiles/${PROFILE.id}`]: () =>
        Response.json({ profile: PROFILE, latestKundali: null, access: 'owner', sharedBy: null }),
      [`GET /api/profiles/${PROFILE.id}/kundali`]: () => Response.json({ items: [] }),
      [`GET /api/profiles/${PROFILE.id}/shares`]: () => Response.json({ items: shares }),
      [`POST /api/profiles/${PROFILE.id}/shares`]: (_u, init) => {
        const { email } = JSON.parse(String(init.body)) as { email: string };
        shares = [{ email, createdAt: '2026-11-03T00:00:00.000Z' }];
        return Response.json({ items: shares }, { status: 201 });
      },
    });
    renderApp(`/profiles/${PROFILE.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = dialogWith('Share Arjun Sharma');
    const input = within(dialog).getByLabelText('Email address');
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share', hidden: true }));
    expect(await within(dialog).findByText('Enter a valid email address')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '  Kid@Example.com ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share', hidden: true }));
    expect(await within(dialog).findByText('kid@example.com')).toBeInTheDocument();
  });
});
