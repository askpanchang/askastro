import { planetName, signName } from '../../shared/astro';
import { allAntardashas, isoDateInZone, subPeriods } from '../../shared/dasha';
import type { AskPanchangKundali } from '../../shared/kundali';
import {
  houseFrom,
  localMidnight,
  signAt,
  weekLines,
  type TransitEvent,
  type TransitSnapshot,
} from './transits';

/**
 * Period forecasts ("this week day by day", "monthly predictions", "this
 * year month by month"). The question's horizon decides which extra context
 * the model gets: dasha periods in the range for all of them, a 30-day
 * transiting-Moon table for a month, and a month-by-month planet table for
 * a year. (The 7-day table is always in the digest.)
 */

export type Horizon = 'week' | 'month' | 'year';

const DAY = 86_400;
/** AskPanchang location id; sidereal signs don't depend on location. */
const LOC = 101;
const MONTH_DAYS = 30;
const YEAR_MONTHS = 12;

/** Longest horizon wins: "yearly with month-wise summary" is a year. */
export function detectHorizon(question: string): Horizon | null {
  const q = question.toLowerCase();
  if (/\b(year|yearly|annual|annually|12 months|twelve months|20\d\d)\b/.test(q)) return 'year';
  if (/\b(month|monthly|30 days|thirty days|fortnight|next few weeks)\b/.test(q)) return 'month';
  if (
    /\b(week|weekly|7 days|seven days|day[- ]by[- ]day|day[- ]wise|daily|today|tomorrow|tonight)\b/.test(
      q,
    )
  )
    return 'week';
  return null;
}

/**
 * Fast-planet events for a month (with the Moon) or a year (without: it
 * changes sign ~160 times a year). Cached per UTC day; null if unavailable.
 */
export async function fetchPeriodEvents(
  env: Pick<Env, 'ASKPANCHANG_API_BASE'>,
  asOfSec: number,
  horizon: Horizon,
  fetcher?: typeof fetch,
): Promise<TransitEvent[] | null> {
  if (horizon === 'week') return [];
  const dayStart = asOfSec - (asOfSec % DAY);
  const key = new Request(`https://transit-cache.internal/period-v1?d=${dayStart}&h=${horizon}`);
  const cache = typeof caches !== 'undefined' ? await caches.open('transits') : null;
  const hit = await cache?.match(key);
  if (hit) return (await hit.json()) as TransitEvent[];
  const body =
    horizon === 'month'
      ? { l: LOC, from: dayStart - DAY, to: dayStart + (MONTH_DAYS + 3) * DAY, pl: [1, 2, 3, 4, 6] }
      : { l: LOC, from: dayStart - DAY, to: dayStart + 400 * DAY, pl: [1, 3, 4, 6] };
  try {
    const res = await (fetcher ?? fetch)(
      `${env.ASKPANCHANG_API_BASE.replace(/\/+$/, '')}/api/v1/planets/timeline`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      console.error('period_upstream_status', res.status);
      return null;
    }
    const items = ((await res.json()) as { items?: TransitEvent[] }).items ?? [];
    const events = items.filter((e) => e.typ !== 'nakshatra').sort((a, b) => a.dt - b.dt);
    await cache?.put(
      key,
      new Response(JSON.stringify(events), { headers: { 'cache-control': 'max-age=86400' } }),
    );
    return events;
  } catch {
    console.error('period_upstream_unreachable');
    return null;
  }
}

/** Mahadasha–antardasha–pratyantar periods overlapping [from, to). */
export function dashaInRange(k: AskPanchangKundali, from: number, to: number) {
  return allAntardashas(k)
    .filter((a) => a.to > from && a.from < to)
    .flatMap((a) =>
      subPeriods(a)
        .filter((p) => p.to > from && p.from < to)
        .map((p) => ({ md: a.md, ad: a.lord, pd: p.lord, from: p.from, to: p.to })),
    );
}

const RANGE_DAYS: Record<Horizon, number> = { week: 7, month: MONTH_DAYS, year: 365 };

export function periodLines(
  k: AskPanchangKundali,
  horizon: Horizon,
  ctx: {
    tz: string;
    nowSec: number;
    transits: TransitSnapshot | null;
    events: TransitEvent[] | null;
  },
): string[] {
  const { tz, nowSec, transits, events } = ctx;
  const day = (sec: number) => isoDateInZone(sec, tz);
  const start = localMidnight(nowSec, tz);
  const end = start + RANGE_DAYS[horizon] * DAY;
  const out: string[] = [];

  out.push('', `## DASHA PERIODS IN RANGE (${day(start)} → ${day(end)})`);
  for (const d of dashaInRange(k, start, end)) {
    out.push(
      `${planetName(d.md)}–${planetName(d.ad)}–${planetName(d.pd)} (MD–AD–PD) ${day(d.from)} → ${day(d.to)}`,
    );
  }

  if (horizon === 'month') {
    if (transits && events?.length) {
      out.push(
        ...weekLines(k, transits, tz, nowSec, {
          days: MONTH_DAYS,
          events,
          title: `NEXT ${MONTH_DAYS} DAYS`,
        }),
      );
    } else {
      out.push('', 'Day-by-day transit data for the month is unavailable.');
    }
  }
  if (horizon === 'year') {
    if (transits && events) out.push(...yearLines(k, transits, events, tz, nowSec));
    else out.push('', 'Month-by-month transit data for the year is unavailable.');
  }
  return out;
}

const SHOWN = [1, 3, 4, 6, 5, 7, 8, 9]; // Moon omitted: it changes sign every ~2.25 days
const FAST = new Set([1, 3, 4, 6]);

/** One line per calendar month: each planet's sign (houses), changes and retro turns. */
function yearLines(
  k: AskPanchangKundali,
  snap: TransitSnapshot,
  fast: TransitEvent[],
  tz: string,
  nowSec: number,
): string[] {
  const lagna = k.info.lagna;
  const moon = k.info.rashi;
  const monthFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    month: 'long',
    year: 'numeric',
  });
  const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' });
  const h = (sign: number) => `H${houseFrom(sign, lagna)}/H${houseFrom(sign, moon)}`;
  const eventsFor = (p: number) => (FAST.has(p) ? fast : snap.events);
  const retroAt = (p: number, at: number) => {
    const now = snap.planets.find((x) => x.p === p);
    let r = now?.retro ?? false;
    for (const e of eventsFor(p)) {
      if (e.p !== p || e.dt <= snap.asOfSec || e.dt > at) continue;
      if (e.typ === 'retro') r = true;
      if (e.typ === 'direct') r = false;
    }
    return r;
  };

  const out = [
    '',
    `## NEXT ${YEAR_MONTHS} MONTHS (houses as H<from Lagna>/H<from Moon>; R = retrograde)`,
  ];
  const [y, m] = isoDateInZone(nowSec, tz).split('-').map(Number) as [number, number];
  for (let i = 0; i < YEAR_MONTHS; i++) {
    const from = i === 0 ? nowSec : localMidnight(Date.UTC(y, m - 1 + i, 1, 12) / 1000, tz);
    const to = localMidnight(Date.UTC(y, m + i, 1, 12) / 1000, tz);
    const start: string[] = [];
    const changes: { dt: number; text: string }[] = [];
    for (const p of SHOWN) {
      const sign = signAt(snap, p, from, eventsFor(p));
      if (sign === null) continue;
      const node = p === 8 || p === 9;
      start.push(
        `${planetName(p)} ${signName(sign)} ${h(sign)}${!node && retroAt(p, from) ? ' R' : ''}`,
      );
      for (const e of eventsFor(p)) {
        if (e.p !== p || e.dt < from || e.dt >= to) continue;
        const when = dayFmt.format(new Date(e.dt * 1000));
        if (e.typ === 'rashi' && e.to !== undefined)
          changes.push({
            dt: e.dt,
            text: `${when} ${planetName(p)} enters ${signName(e.to)} ${h(e.to)}`,
          });
        else if (!node && e.typ === 'retro')
          changes.push({ dt: e.dt, text: `${when} ${planetName(p)} turns retrograde` });
        else if (!node && e.typ === 'direct')
          changes.push({ dt: e.dt, text: `${when} ${planetName(p)} turns direct` });
      }
    }
    out.push(
      `### ${monthFmt.format(new Date(((from + to) / 2) * 1000))}`,
      `At ${i === 0 ? 'today' : 'the start'}: ${start.join('; ')}`,
      `Changes: ${
        changes.length
          ? changes
              .sort((a, b) => a.dt - b.dt)
              .map((c) => c.text)
              .join('; ')
          : 'none'
      }`,
    );
  }
  return out;
}
