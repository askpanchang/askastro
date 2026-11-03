import { planetName, signName } from '../../../shared/astro';
import type { ChartHouse, ChartPlanet } from '../../../shared/chartModel';

/** "Sa 26°R" in D1, "Sa(R)" elsewhere: abbreviation, degree (D1 only), R for retrograde. */
export function planetLabel(p: ChartPlanet): string {
  const retro = p.retro ? (p.degree !== null ? 'R' : '(R)') : '';
  return `${p.abbr}${p.degree !== null ? ` ${p.degree}°` : ''}${retro}`;
}

/** Screen-reader summary of a chart. */
export function chartAriaLabel(houses: ChartHouse[], title: string): string {
  const asc = houses.find((h) => h.asc);
  const parts = houses
    .filter((h) => h.planets.length)
    .map(
      (h) =>
        `house ${h.house} (${signName(h.sign)}): ${h.planets
          .map((p) => `${planetName(p.code)}${p.retro ? ' retrograde' : ''}`)
          .join(', ')}`,
    );
  return `${title}. Ascendant ${asc ? signName(asc.sign) : 'unknown'}. ${parts.join('; ')}.`;
}
