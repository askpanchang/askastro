import { CHART_NAMES, dignityName, ordinal, planetName, signName } from '../../shared/astro';
import { allAntardashas, isoDateInZone } from '../../shared/dasha';
import type { AskPanchangKundali } from '../../shared/kundali';
import { houseFacts, lordships } from './chartFacts';
import { doubleTransitWindows, type TransitSnapshot } from './transits';

/**
 * Topic-focused context: for a question about marriage, career, money … the
 * model gets the relevant houses, lords, significators, divisional chart,
 * dasha activations and transit windows already joined together.
 */

type Topic = {
  id: string;
  label: string;
  match: RegExp;
  houses: number[];
  /** Natural significators; `female` overrides for female charts. */
  karakas: number[];
  karakasFemale?: number[];
  varga?: string;
};

export const TOPICS: Topic[] = [
  {
    id: 'marriage',
    label: 'Marriage and relationships',
    match:
      /\b(marri|wedding|spouse|wife|husband|partner|relationship|love|romance|divorce|match(ing)?|engage)/i,
    houses: [7, 2, 11],
    karakas: [6],
    karakasFemale: [5, 6],
    varga: 'D9',
  },
  {
    id: 'career',
    label: 'Career and profession',
    match:
      /\b(career|job|profession|work|business|promotion|employ|boss|office|occupation|vocation)/i,
    houses: [10, 6, 11],
    karakas: [1, 7],
    varga: 'D10',
  },
  {
    id: 'finance',
    label: 'Wealth and finances',
    match: /\b(money|wealth|financ|income|rich|invest|savings|gain|loss|debt|loan|property value)/i,
    houses: [2, 11, 9, 5],
    karakas: [5],
    varga: 'D2',
  },
  {
    id: 'children',
    label: 'Children',
    match: /\b(child|children|kid|son|daughter|pregnan|conceiv|progeny|baby)/i,
    houses: [5, 9],
    karakas: [5],
    varga: 'D7',
  },
  {
    id: 'education',
    label: 'Education and learning',
    match: /\b(educat|study|studies|exam|degree|college|universit|school|learning|research)/i,
    houses: [4, 5, 9],
    karakas: [4, 5],
    varga: 'D24',
  },
  {
    id: 'health',
    label: 'Health tendencies',
    match: /\b(health|illness|disease|sick|medical|surgery|wellness|fitness|stress|anxiety)/i,
    houses: [1, 6, 8],
    karakas: [1, 2],
  },
  {
    id: 'property',
    label: 'Home, property and vehicles',
    // Not plain "house": astrology questions mention houses all the time.
    match:
      /\b(buy(ing)? a (house|home|flat)|own (a|my) (house|home)|new home|property|land|real estate|vehicle|car|flat|apartment)\b/i,
    houses: [4, 11],
    karakas: [3, 6],
    varga: 'D4',
  },
  {
    id: 'travel',
    label: 'Travel and foreign lands',
    match: /\b(travel|abroad|foreign|overseas|visa|relocat|emigrat|settle (in|abroad))/i,
    houses: [12, 9, 3],
    karakas: [8],
  },
  {
    id: 'spiritual',
    label: 'Spiritual growth',
    match: /\b(spiritual|meditat|moksha|dharma|religio|god|sadhana|guru)/i,
    houses: [9, 12, 5],
    karakas: [5, 9],
    varga: 'D20',
  },
  {
    id: 'parents',
    label: 'Parents',
    match: /\b(mother|father|parent|mom|dad)/i,
    houses: [4, 9],
    karakas: [2, 1],
  },
  {
    id: 'siblings',
    label: 'Siblings',
    match: /\b(sibling|brother|sister)/i,
    houses: [3, 11],
    karakas: [3],
  },
];

/** Topics a question is about (at most two, in list order). */
export function detectTopics(question: string): Topic[] {
  return TOPICS.filter((t) => t.match.test(question)).slice(0, 2);
}

export function topicLines(
  k: AskPanchangKundali,
  topics: Topic[],
  ctx: { gender: string; tz: string; asOfSec: number; transits: TransitSnapshot | null },
): string[] {
  if (!topics.length) return [];
  const day = (sec: number) => isoDateInZone(sec, ctx.tz);
  const facts = new Map(houseFacts(k).map((f) => [f.house, f]));
  const pl = new Map(k.pl.map((p) => [p.p, p]));
  const lords = lordships(k);
  const out: string[] = [];

  const planetLine = (code: number) => {
    const p = pl.get(code);
    if (!p) return planetName(code);
    const flags = [p.rx ? 'retrograde' : null, p.cmb ? 'combust' : null].filter(Boolean);
    return `${planetName(code)} in ${signName(p.r)} H${p.h}${p.dig !== undefined ? `, ${dignityName(p.dig)}` : ''}${flags.length ? `, ${flags.join(', ')}` : ''}${(lords.get(code) ?? []).length ? `; rules ${(lords.get(code) ?? []).map(ordinal).join(' and ')}` : ''}`;
  };

  for (const t of topics) {
    out.push('', `## TOPIC FOCUS: ${t.label.toUpperCase()} (pre-computed for this question)`);
    // Dasha relevance: the main house's lord and occupants, plus the significators.
    const relevant = new Set<number>();
    const main = facts.get(t.houses[0]!);
    if (main) {
      relevant.add(main.lord);
      main.occupants.forEach((o) => relevant.add(o));
    }
    for (const h of t.houses) {
      const f = facts.get(h);
      if (!f) continue;
      out.push(
        `H${h} (${signName(f.sign)}): lord ${planetLine(f.lord)}` +
          ` | occupants: ${f.occupants.length ? f.occupants.map(planetName).join(', ') : 'none'}` +
          ` | aspected by: ${f.aspects.length ? f.aspects.map((a) => planetName(a.planet)).join(', ') : 'none'}` +
          `${f.sav !== undefined ? ` | SAV ${f.sav}` : ''}`,
      );
    }
    const karakas = ctx.gender === 'f' && t.karakasFemale ? t.karakasFemale : t.karakas;
    karakas.forEach((c) => relevant.add(c));
    out.push(`Significators: ${karakas.map(planetLine).join('; ')}`);

    if (t.varga && k.charts[t.varga]?.length === 12) {
      const cells = k.charts[t.varga]!;
      const asc = cells.find((c) => c.asc);
      const where = (code: number) => {
        const c = cells.find((x) => x.p.includes(code));
        return c ? `${planetName(code)} ${signName(c.r)} (H${c.h})` : null;
      };
      const mainLord = facts.get(t.houses[0]!)?.lord;
      const show = [...new Set([mainLord, ...karakas].filter((x): x is number => x !== undefined))];
      out.push(
        `${CHART_NAMES[t.varga] ?? t.varga}: Lagna ${asc ? signName(asc.r) : '?'}; ${show
          .map(where)
          .filter(Boolean)
          .join(', ')}`,
      );
    }

    // Dasha periods over the next 10 years whose MD or AD lord is relevant.
    const horizon = ctx.asOfSec + 10 * 365 * 86_400;
    const acts = allAntardashas(k)
      .filter((a) => a.to > ctx.asOfSec && a.from < horizon)
      .filter((a) => relevant.has(a.lord) || relevant.has(a.md))
      .slice(0, 8)
      .map((a) => {
        const why = [a.md, a.lord]
          .filter((c, i, arr) => relevant.has(c) && arr.indexOf(c) === i)
          .map((c) => {
            const h0 = t.houses[0]!;
            const roles = [
              ...(facts.get(h0)?.lord === c ? [`${ordinal(h0)} lord`] : []),
              ...(facts.get(h0)?.occupants.includes(c) ? [`in ${ordinal(h0)}`] : []),
              ...(karakas.includes(c) ? ['significator'] : []),
            ];
            return `${planetName(c)}: ${roles.join(', ')}`;
          });
        return `${planetName(a.md)}–${planetName(a.lord)} ${day(a.from)} → ${day(a.to)} (${why.join('; ')})`;
      });
    out.push(
      acts.length
        ? `Dasha activations (next 10 years): ${acts.join('; ')}`
        : 'Dasha activations (next 10 years): none of the topic lords or significators run a period.',
    );

    if (ctx.transits) {
      const w = doubleTransitWindows(ctx.transits, k.info.lagna, t.houses[0]!);
      out.push(
        `Jupiter–Saturn double transit on H${t.houses[0]} (next 3 years): ${
          w.length ? w.map((x) => `${day(x.from)} → ${day(x.to)}`).join('; ') : 'none'
        }`,
      );
    }
  }
  return out;
}
