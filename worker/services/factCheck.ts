import { ordinal, planetName, signName } from '../../shared/astro';
import { isoDateInZone } from '../../shared/dasha';
import type { AskPanchangKundali } from '../../shared/kundali';
import { lordships } from './chartFacts';
import type { TransitEvent } from './transits';

/**
 * Deterministic fact-check of an answer against the chart: house lordships,
 * D1 signs and D1 houses stated in the text. Conservative: sentences about
 * transits, the Moon chart or divisional charts are skipped, so a flagged
 * claim is very likely a real mistake.
 */

export type FactIssue = { claim: string; correction: string };

const PLANETS: Record<string, number> = {
  sun: 1,
  surya: 1,
  moon: 2,
  chandra: 2,
  mars: 3,
  mangal: 3,
  mangala: 3,
  kuja: 3,
  mercury: 4,
  budha: 4,
  jupiter: 5,
  guru: 5,
  brihaspati: 5,
  venus: 6,
  shukra: 6,
  saturn: 7,
  shani: 7,
  rahu: 8,
  ketu: 9,
};
const SIGNS: Record<string, number> = {
  aries: 1,
  mesha: 1,
  taurus: 2,
  vrishabha: 2,
  gemini: 3,
  mithuna: 3,
  cancer: 4,
  karka: 4,
  leo: 5,
  simha: 5,
  virgo: 6,
  kanya: 6,
  libra: 7,
  tula: 7,
  scorpio: 8,
  vrischika: 8,
  sagittarius: 9,
  dhanu: 9,
  capricorn: 10,
  makara: 10,
  aquarius: 11,
  kumbha: 11,
  pisces: 12,
  meena: 12,
};

const P = Object.keys(PLANETS).join('|');
const S = Object.keys(SIGNS).join('|');
const ORD = String.raw`(\d{1,2})(?:st|nd|rd|th)`;
const ORD_LIST = String.raw`${ORD}(?:\s*(?:,|and|&|/)\s*(?:the\s+)?${ORD})?`;

/**
 * Sentences where another frame of reference makes different signs/houses
 * correct: transits (incl. day-by-day forecasts), the Moon chart, vargas.
 */
const OTHER_FRAME =
  /\b(transit|transits|transiting|gochar|currently|right now|enters|entering|moves? into|will move|will be in|today|tonight|tomorrow|this week|next week|this month|next month|this year|next year|january|february|march|april|june|july|august|september|october|november|december|mon|tue|wed|thu|fri|sat|sun(?=\s*\d)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|day \d|\d{4}-\d{2}-\d{2}|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}|from the moon|from moon|chandra lagna|moon chart|navamsa|navamsha|d-?9|d-?10|dasamsa|d-?\d{1,2}\b|varga|chalit|from the sun|from venus|from jupiter|in the [a-z]+ chart|sade sati|panoti|dhaiya|ashtama shani)\b|→|->/i;

/** Strip Markdown and normalise hyphen variants (models often use U+2011 "‑"). */
const clean = (s: string) =>
  s
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ');

/**
 * `transitSigns`: signs each planet occupies now or over the transit timeline.
 * A claim that a planet is "in" one of those is ambiguous (likely about the
 * transit), so it isn't flagged.
 */
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = String.raw`jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?`;
const INGRESS = new RegExp(
  String.raw`\b(${P})\b\s+(?:enters|moves (?:in)?to|shifts (?:in)?to|ingresses into|re-?enters|returns to|retrogrades (?:back )?into)\s+(${S})\b((?:(?!\b(?:${P})\b)[^.;\n]){0,40}?)\b(?:on\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(${MON})\b|(${MON})\s+(\d{1,2})\b)`,
  'gi',
);

/**
 * `timing`: sign-change events from the transit data. "Sun enters Scorpio on
 * 16 Dec" is flagged when the data has the Sun entering Scorpio only on other
 * dates (more than 2 days away).
 */
export function factCheck(
  answer: string,
  k: AskPanchangKundali,
  transitSigns?: Map<number, Set<number>>,
  timing?: { events: TransitEvent[]; tz: string },
): FactIssue[] {
  const lords = lordships(k);
  const sign = new Map(k.pl.map((p) => [p.p, p.r]));
  const house = new Map(k.pl.map((p) => [p.p, p.h]));
  const issues: FactIssue[] = [];
  const seen = new Set<string>();
  const add = (claim: string, correction: string) => {
    if (seen.has(correction)) return;
    seen.add(correction);
    issues.push({ claim: claim.trim().slice(0, 120), correction });
  };
  const lordsText = (p: number) => {
    const hs = lords.get(p) ?? [];
    return hs.length
      ? `${planetName(p)} rules the ${hs.map(ordinal).join(' and ')} house${hs.length > 1 ? 's' : ''}`
      : `${planetName(p)} rules no house`;
  };

  const sentences = clean(answer).split(/(?<=[.!?;])\s+|\n+|\s\|\s/);
  for (const s of sentences) {
    if (timing) checkIngressDates(s, timing);
    if (!s.trim() || OTHER_FRAME.test(s)) continue;

    // "Venus, lord of the 7th and 12th" / "Venus (lord of the 2nd)"
    // (no other planet name may sit between the planet and "lord of")
    for (const m of s.matchAll(
      new RegExp(
        String.raw`\b(${P})\b(?:(?!\b(?:${P})\b)[^.;:|]){0,30}?\b(?:lord|ruler)s?\s+of\s+(?:the\s+)?${ORD_LIST}`,
        'gi',
      ),
    )) {
      checkLord(m[0], PLANETS[m[1]!.toLowerCase()]!, [m[2], m[3]]);
    }
    // "7th lord Venus" / "7th-lord, Venus"
    for (const m of s.matchAll(
      new RegExp(String.raw`\b${ORD}[- ]lord,?\s+(?:is\s+)?(${P})\b`, 'gi'),
    )) {
      checkLord(m[0], PLANETS[m[2]!.toLowerCase()]!, [m[1]]);
    }
    // "Venus (7th lord)" / "Venus (2nd & 5th lord)"
    for (const m of s.matchAll(
      new RegExp(String.raw`\b(${P})\s*\(\s*${ORD_LIST}\s*(?:house\s+)?lord\s*\)`, 'gi'),
    )) {
      checkLord(m[0], PLANETS[m[1]!.toLowerCase()]!, [m[2], m[3]]);
    }
    // "Moon in Taurus" / "Moon is placed in Cancer"
    for (const m of s.matchAll(
      new RegExp(
        String.raw`\b(${P})\b(?:\s+is)?(?:\s+(?:placed|posited|located|sitting|exalted|debilitated))?\s+in\s+(?:the\s+sign\s+(?:of\s+)?)?(${S})\b`,
        'gi',
      ),
    )) {
      const p = PLANETS[m[1]!.toLowerCase()]!;
      const claimed = SIGNS[m[2]!.toLowerCase()]!;
      if (sign.has(p) && sign.get(p) !== claimed && !transitSigns?.get(p)?.has(claimed)) {
        add(
          m[0],
          `${planetName(p)} is in ${signName(sign.get(p)!)} in the birth chart, not ${signName(claimed)}.`,
        );
      }
    }
    // "Mars in the 6th house"
    for (const m of s.matchAll(
      new RegExp(
        String.raw`\b(${P})\b(?:\s+is)?(?:\s+(?:placed|posited|located|sitting))?\s+in\s+(?:the\s+)?${ORD}\s+house`,
        'gi',
      ),
    )) {
      const p = PLANETS[m[1]!.toLowerCase()]!;
      const claimed = Number(m[2]);
      if (house.has(p) && house.get(p) !== claimed) {
        add(
          m[0],
          `${planetName(p)} is in the ${ordinal(house.get(p)!)} house of the birth chart, not the ${ordinal(claimed)}.`,
        );
      }
    }
  }
  return issues;

  function checkIngressDates(s: string, t: { events: TransitEvent[]; tz: string }) {
    for (const m of s.matchAll(INGRESS)) {
      const planet = PLANETS[m[1]!.toLowerCase()]!;
      const to = SIGNS[m[2]!.toLowerCase()]!;
      const day = Number(m[4] ?? m[7]);
      const month = MONTHS.indexOf((m[5] ?? m[6])!.slice(0, 3).toLowerCase());
      if (month < 0 || day < 1 || day > 31) continue;
      const actual = t.events.filter((e) => e.p === planet && e.typ === 'rashi' && e.to === to);
      if (!actual.length) continue; // outside the data's range: can't tell
      const dates = actual.map((e) => isoDateInZone(e.dt, t.tz));
      const close = dates.some((d) => {
        const [y, mo, dd] = d.split('-').map(Number) as [number, number, number];
        const at = Date.UTC(y, mo - 1, dd);
        return [y - 1, y, y + 1].some(
          (yy) => Math.abs(Date.UTC(yy, month, day) - at) <= 2 * 86_400_000,
        );
      });
      if (!close) {
        const fmt = (d: string) => {
          const [y, mo, dd] = d.split('-').map(Number) as [number, number, number];
          return `${dd} ${MONTH_NAMES[mo - 1]} ${y}`;
        };
        add(
          m[0],
          `${planetName(planet)} enters ${signName(to)} on ${[...new Set(dates)].map(fmt).join(' and ')}, not ${day} ${MONTH_NAMES[month]}.`,
        );
      }
    }
  }

  function checkLord(claim: string, planet: number, nums: (string | undefined)[]) {
    if (planet === 8 || planet === 9) {
      add(claim, `${planetName(planet)} rules no house in Parashari astrology.`);
      return;
    }
    const owned = lords.get(planet) ?? [];
    for (const n of nums) {
      if (!n) continue;
      const h = Number(n);
      if (h >= 1 && h <= 12 && !owned.includes(h))
        add(claim, `${lordsText(planet)}, not the ${ordinal(h)}.`);
    }
  }
}

/** Markdown note appended to an answer when the check finds mistakes. */
export function correctionNote(issues: FactIssue[]): string {
  if (!issues.length) return '';
  return `\n\n---\n**Chart check:** ${issues.length === 1 ? 'one statement above does' : 'some statements above do'} not match this chart. ${issues.map((i) => i.correction).join(' ')}`;
}
