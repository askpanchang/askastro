import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILE, mockApi, renderApp } from './renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
              },
            ])
          : listOf([{ ...PROFILE, kundaliStatus: 'current', lastSessionAt: null }], 'c1'),
    });
    renderApp('/');
    const card = await screen.findByRole('link', { name: /Arjun Sharma/ });
    expect(within(card).getByText('Kundali ready')).toBeInTheDocument();
    expect(within(card).getByText(/15 Aug 1990 · 14:30 \(2:30 PM\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Meera Iyer')).toBeInTheDocument();
    expect(screen.getByText('Needs regenerating')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
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
    expect(fetch).not.toHaveBeenCalled();
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
        Response.json({ profile: PROFILE, latestKundali: null }),
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
    await waitFor(() => expect(router.state.location.pathname).toBe(`/profiles/${PROFILE.id}`));
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
        Response.json({ profile: PROFILE, latestKundali: null }),
      [`DELETE /api/profiles/${PROFILE.id}`]: () => {
        deleted = true;
        return Response.json({ ok: true });
      },
      'GET /api/profiles': () => listOf([]),
    });
    const { router } = renderApp(`/profiles/${PROFILE.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete profile', hidden: true }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(deleted).toBe(true);
  });
});
