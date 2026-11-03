import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toChartHouses } from '../../shared/chartModel';
import { AskPanchangKundaliSchema } from '../../shared/kundali';
import { ChartNorth } from '../../src/components/kundali/ChartNorth';
import { ChartSouth } from '../../src/components/kundali/ChartSouth';
import fixture from '../fixtures/askpanchang-sample.json';
import { PROFILE, mockApi, renderApp } from './renderApp';

const data = AskPanchangKundaliSchema.parse(fixture);
const houses = toChartHouses(data, 'D1')!;

afterEach(() => vi.unstubAllGlobals());

describe('chart components', () => {
  it('normalizes the fixture into houses with the right planets', () => {
    const h9 = houses.find((h) => h.house === 9)!;
    expect(h9.sign).toBe(4);
    expect(h9.planets.map((p) => p.abbr)).toEqual(['Su', 'Ju', 'Ve', 'Ke']);
    expect(houses.find((h) => h.asc)?.sign).toBe(8);
  });

  it.each([
    ['North', ChartNorth],
    ['South', ChartSouth],
  ])('%s chart renders planets in the correct houses', (_name, Chart) => {
    const { container } = render(<Chart houses={houses} title="Rasi (D1)" />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('Ascendant Scorpio');
    expect(svg.getAttribute('aria-label')).toContain(
      'house 9 (Cancer): Sun, Jupiter, Venus, Ketu retrograde',
    );
    expect(container.textContent).toContain('Sa 26°R');
    expect(container.textContent).toContain('Asc');
  });
});

describe('kundali tab', () => {
  const version = {
    id: '22222222-2222-4222-8222-222222222222',
    profileId: PROFILE.id,
    ayanamsa: 'lahiri',
    chartStyle: 'north',
    lang: 'en',
    timeUncertain: false,
    stale: false,
    createdAt: '2026-11-03T10:00:00.000Z',
  };

  it('generates a kundali from the empty state', async () => {
    let posted: unknown;
    let generated = false;
    mockApi({
      [`GET /api/profiles/${PROFILE.id}`]: () =>
        Response.json({ profile: PROFILE, latestKundali: null, access: 'owner', sharedBy: null }),
      [`GET /api/profiles/${PROFILE.id}/kundali`]: () =>
        Response.json({ items: generated ? [version] : [] }),
      [`POST /api/profiles/${PROFILE.id}/kundali`]: (_u, init) => {
        posted = JSON.parse(String(init.body));
        generated = true;
        return Response.json(
          { kundali: { ...version, data: fixture, digest: 'x' } },
          { status: 201 },
        );
      },
    });
    renderApp(`/profiles/${PROFILE.id}`);
    fireEvent.change(await screen.findByLabelText('Ayanamsa'), { target: { value: 'raman' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate kundali' }));
    await waitFor(() =>
      expect(posted).toEqual({ ayanamsa: 'raman', chartStyle: 'north', lang: 'en' }),
    );
    expect(await screen.findByText('Scorpio (Vrischika) 26°28′')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planetary positions' })).toBeInTheDocument();
  });
});
