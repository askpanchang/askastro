import { planetAbbr } from './astro';
import type { AskPanchangKundali } from './kundali';

export type ChartPlanet = { code: number; abbr: string; degree: number | null; retro: boolean };
/** Normalized chart house used by ChartNorth / ChartSouth. */
export type ChartHouse = { house: number; sign: number; asc: boolean; planets: ChartPlanet[] };

/** Charts in the order the UI offers them, filtered to those the API returned. */
export function availableCharts(k: AskPanchangKundali): string[] {
  const preferred = ['D1', 'D9', 'D10', 'CHALIT', 'MOON', 'SUN'];
  const rest = Object.keys(k.charts)
    .filter((c) => !preferred.includes(c))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return [...preferred.filter((c) => k.charts[c]?.length === 12), ...rest];
}

export function toChartHouses(k: AskPanchangKundali, chart: string): ChartHouse[] | null {
  const cells = k.charts[chart];
  if (!cells || cells.length !== 12) return null;
  // Degrees only make sense where the planet's sign is its natal (D1) sign.
  const withDegrees = chart === 'D1';
  const byCode = new Map(k.pl.map((p) => [p.p, p]));
  return [...cells]
    .sort((a, b) => a.h - b.h)
    .map((c) => ({
      house: c.h,
      sign: c.r,
      asc: Boolean(c.asc),
      planets: c.p.map((code) => {
        const pl = byCode.get(code);
        return {
          code,
          abbr: planetAbbr(code),
          degree: withDegrees && pl ? pl.deg : null,
          retro: Boolean(pl?.rx),
        };
      }),
    }));
}
