import { ordinal, planetName } from '../../shared/astro';
import type { AskPanchangKundali } from '../../shared/kundali';

/**
 * Deterministic chart facts the model would otherwise have to derive (and
 * often got wrong in tests): lordships, aspects onto houses, house roles.
 * Pure functions over the AskPanchang response.
 */

/** Planet codes 1 Sun … 9 Ketu. */
export const PLANET_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const KENDRA = new Set([1, 4, 7, 10]);
const TRIKONA = new Set([1, 5, 9]);
const DUSTHANA = new Set([6, 8, 12]);
const UPACHAYA = new Set([3, 6, 10, 11]);

/** Natural significators (karakas) of each house, traditional Parashari list. */
export const HOUSE_KARAKAS: Readonly<Record<number, { planets: number[]; themes: string }>> = {
  1: { planets: [1], themes: 'self, body, vitality' },
  2: { planets: [5], themes: 'wealth, family, speech' },
  3: { planets: [3], themes: 'courage, siblings, effort' },
  4: { planets: [2, 6], themes: 'mother, home, property, vehicles' },
  5: { planets: [5], themes: 'children, intellect, past merit' },
  6: { planets: [3, 7], themes: 'health issues, enemies, service, debts' },
  7: { planets: [6], themes: 'spouse, partnership, marriage' },
  8: { planets: [7], themes: 'longevity themes, sudden events, inheritance, research' },
  9: { planets: [5, 1], themes: 'father, fortune, dharma, higher learning' },
  10: { planets: [1, 4, 5, 7], themes: 'career, status, action' },
  11: { planets: [5], themes: 'gains, income, friends, wishes' },
  12: { planets: [7], themes: 'losses, expenses, foreign lands, liberation' },
};

/** Houses each planet rules (from the API's house lords). Rahu/Ketu rule none. */
export function lordships(k: AskPanchangKundali): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const h of [...k.houses].sort((a, b) => a.h - b.h)) {
    out.set(h.lord, [...(out.get(h.lord) ?? []), h.h]);
  }
  return out;
}

/** Lord of a house (1–12). */
export function lordOf(k: AskPanchangKundali, house: number): number | undefined {
  return k.houses.find((h) => h.h === house)?.lord;
}

/** D1 house of each planet. */
export function planetHouse(k: AskPanchangKundali): Map<number, number> {
  return new Map(k.pl.map((p) => [p.p, p.h]));
}

const addHouse = (from: number, n: number) => ((from - 1 + n - 1) % 12) + 1;

/**
 * Parashari graha drishti onto houses: every planet aspects the 7th from
 * itself; Mars also the 4th and 8th, Jupiter the 5th and 9th, Saturn the 3rd
 * and 10th. Rahu/Ketu: 7th only (traditions differ on their special aspects).
 */
export function aspectedHouses(planet: number, fromHouse: number): number[] {
  return aspectCounts(planet).map((n) => addHouse(fromHouse, n));
}

const aspectCounts = (planet: number) =>
  planet === 3 ? [4, 7, 8] : planet === 5 ? [5, 7, 9] : planet === 7 ? [3, 7, 10] : [7];

/** For each house, the planets aspecting it (with the aspect count). */
export function aspectsOnHouses(
  k: AskPanchangKundali,
): Map<number, { planet: number; n: number }[]> {
  const out = new Map<number, { planet: number; n: number }[]>();
  for (const p of k.pl) {
    for (const n of aspectCounts(p.p)) {
      const h = addHouse(p.h, n);
      out.set(h, [...(out.get(h) ?? []), { planet: p.p, n }]);
    }
  }
  return out;
}

/** Factual role tags from the houses a planet rules (for this Lagna). */
export function lordshipTags(houses: number[]): string[] {
  const tags: string[] = [];
  if (houses.includes(1)) tags.push('Lagna lord');
  const kendra = houses.filter((h) => KENDRA.has(h) && h !== 1);
  const trikona = houses.filter((h) => TRIKONA.has(h) && h !== 1);
  if (kendra.length && trikona.length) tags.push('Yogakaraka (rules a kendra and a trikona)');
  else {
    if (trikona.length) tags.push('trikona lord');
    if (kendra.length) tags.push('kendra lord');
  }
  if (houses.some((h) => DUSTHANA.has(h))) tags.push('dusthana lord');
  if (houses.some((h) => h === 3 || h === 11)) tags.push('upachaya (3rd/11th) lord');
  return tags;
}

export type HouseFact = {
  house: number;
  sign: number;
  lord: number;
  lordHouse: number | undefined;
  occupants: number[];
  aspects: { planet: number; n: number }[];
  sav: number | undefined;
  kind: string[];
};

export function houseFacts(k: AskPanchangKundali): HouseFact[] {
  const asp = aspectsOnHouses(k);
  const where = planetHouse(k);
  return [...k.houses]
    .sort((a, b) => a.h - b.h)
    .map((h) => ({
      house: h.h,
      sign: h.r,
      lord: h.lord,
      lordHouse: h.lh ?? where.get(h.lord),
      occupants: h.p,
      aspects: asp.get(h.h) ?? [],
      sav: h.sav,
      kind: [
        KENDRA.has(h.h) ? 'kendra' : null,
        TRIKONA.has(h.h) ? 'trikona' : null,
        DUSTHANA.has(h.h) ? 'dusthana' : null,
        UPACHAYA.has(h.h) ? 'upachaya' : null,
      ].filter((x): x is string => Boolean(x)),
    }));
}

/** Planets whose Bhava Chalit house differs from the D1 (whole-sign) house. */
export function chalitShifts(
  k: AskPanchangKundali,
): { planet: number; d1: number; chalit: number }[] {
  const chalit = k.charts.CHALIT;
  if (!chalit?.length) return [];
  const chalitHouse = new Map<number, number>();
  for (const cell of chalit) for (const p of cell.p) chalitHouse.set(p, cell.h);
  return k.pl
    .filter((p) => chalitHouse.has(p.p) && chalitHouse.get(p.p) !== p.h)
    .map((p) => ({ planet: p.p, d1: p.h, chalit: chalitHouse.get(p.p)! }));
}

/** House of each planet counted from the Moon (Chandra lagna). */
export function housesFromMoon(k: AskPanchangKundali): Map<number, number> {
  const moon = k.charts.MOON;
  const out = new Map<number, number>();
  if (moon?.length) {
    for (const cell of moon) for (const p of cell.p) out.set(p, cell.h);
    return out;
  }
  const moonSign = k.info.rashi;
  for (const p of k.pl) out.set(p.p, ((p.r - moonSign + 12) % 12) + 1);
  return out;
}

/** Digest lines: lordships/roles, aspects onto houses, karakas, Chalit, from Moon. */
export function chartFactLines(k: AskPanchangKundali): string[] {
  const out: string[] = [];
  const lords = lordships(k);
  out.push('', '## LORDSHIPS AND ROLES (computed for this Lagna)');
  for (const code of PLANET_CODES) {
    const houses = lords.get(code) ?? [];
    if (!houses.length) continue;
    const at = planetHouse(k).get(code);
    out.push(
      `${planetName(code)}: lord of ${houses.map(ordinal).join(' and ')}` +
        `${at ? `; placed in ${ordinal(at)}` : ''}` +
        `${lordshipTags(houses).length ? ` — ${lordshipTags(houses).join(', ')}` : ''}`,
    );
  }
  out.push('Rahu and Ketu rule no house; they act through their sign lord (dispositor) and house.');

  out.push('', '## ASPECTS ONTO HOUSES (Parashari: all 7th; Mars 4/8, Jupiter 5/9, Saturn 3/10)');
  for (const f of houseFacts(k)) {
    out.push(
      `H${f.house}: ${f.aspects.length ? f.aspects.map((a) => `${planetName(a.planet)} (${ordinal(a.n)})`).join(', ') : 'no planetary aspect'}`,
    );
  }

  out.push('', '## HOUSE SIGNIFICATORS (natural karakas)');
  for (const f of houseFacts(k)) {
    const kar = HOUSE_KARAKAS[f.house];
    if (!kar) continue;
    out.push(
      `H${f.house} [${f.kind.join(', ') || '—'}] ${kar.themes}: karaka ${kar.planets.map(planetName).join(', ')}`,
    );
  }

  const shifts = chalitShifts(k);
  out.push('', '## BHAVA CHALIT');
  out.push(
    shifts.length
      ? `Planets that change house in the Chalit chart (use with care for house results): ${shifts
          .map((s) => `${planetName(s.planet)} H${s.d1} → H${s.chalit}`)
          .join('; ')}`
      : 'No planet changes house in the Chalit chart.',
  );

  const fm = housesFromMoon(k);
  out.push('', '## HOUSES FROM THE MOON (Chandra lagna)');
  out.push(
    PLANET_CODES.filter((c) => fm.has(c))
      .map((c) => `${planetName(c)} ${ordinal(fm.get(c)!)}`)
      .join(', '),
  );
  return out;
}
