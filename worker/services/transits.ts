import { ordinal, planetName, signName } from '../../shared/astro';
import { isoDateInZone } from '../../shared/dasha';
import type { AskPanchangKundali } from '../../shared/kundali';
import { aspectedHouses } from './chartFacts';

/**
 * Live planetary transits (gochar) from AskPanchang:
 * POST /api/v1/planets/transit { l, dt, ayan } → current positions
 * POST /api/v1/planets/timeline { l, from, to, pl } → sign changes, retro/direct turns
 * `l` is an AskPanchang location id; sidereal signs don't depend on location.
 */

export type TransitPlanet = { p: number; r: number; deg: number; min: number; retro: boolean };
export type TransitEvent = { p: number; typ: string; dt: number; from?: number; to?: number };
export type TransitSnapshot = {
  asOfSec: number;
  planets: TransitPlanet[];
  /** Slow planets (Jupiter, Saturn, Rahu, Ketu) over the next few years. */
  events: TransitEvent[];
  /** Fast planets (Sun, Moon, Mars, Mercury, Venus) from yesterday to a week ahead. */
  week?: TransitEvent[];
};

const SLOW = [5, 7, 8, 9]; // Jupiter, Saturn, Rahu, Ketu
const FAST = [1, 2, 3, 4, 6]; // Sun, Moon, Mars, Mercury, Venus
const YEARS_AHEAD = 3;
const DAY = 86_400;
/** AskPanchang location id for Hyderabad; any id works for sidereal signs. */
const DEFAULT_LOC = 101;

type Fetcher = typeof fetch;

export async function fetchTransits(
  env: Pick<Env, 'ASKPANCHANG_API_BASE'>,
  asOfSec: number,
  ayanamsa: string,
  fetcher?: Fetcher,
): Promise<TransitSnapshot | null> {
  const dayStart = asOfSec - (asOfSec % DAY);
  const base = env.ASKPANCHANG_API_BASE.replace(/\/+$/, '');
  const key = new Request(`https://transit-cache.internal/v2?d=${dayStart}&a=${ayanamsa}`);
  const cache = typeof caches !== 'undefined' ? await caches.open('transits') : null;
  const hit = await cache?.match(key);
  if (hit) return (await hit.json()) as TransitSnapshot;

  const f = fetcher ?? fetch;
  const post = (path: string, body: unknown) =>
    f(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  try {
    // allSettled: if both calls fail, neither rejection may escape unhandled.
    const [nowR, tlR, weekR] = await Promise.allSettled([
      post('/api/v1/planets/transit', { l: DEFAULT_LOC, dt: dayStart + DAY / 2, ayan: ayanamsa }),
      post('/api/v1/planets/timeline', {
        l: DEFAULT_LOC,
        from: dayStart,
        to: dayStart + YEARS_AHEAD * 365 * DAY,
        pl: SLOW,
      }),
      // Covers the local "today" in every zone, and the next 7 days.
      post('/api/v1/planets/timeline', {
        l: DEFAULT_LOC,
        from: dayStart - DAY,
        to: dayStart + 9 * DAY,
        pl: FAST,
      }),
    ]);
    if (nowR.status !== 'fulfilled' || tlR.status !== 'fulfilled') {
      console.error('transit_upstream_unreachable');
      return null;
    }
    const nowRes = nowR.value;
    const tlRes = tlR.value;
    if (!nowRes.ok || !tlRes.ok) {
      console.error('transit_upstream_status', nowRes.status, tlRes.status);
      return null;
    }
    const now = (await nowRes.json()) as {
      pl?: { p: number; r: number; deg: number; min: number; mo?: number }[];
    };
    const tl = (await tlRes.json()) as { items?: TransitEvent[] };
    // The week table is optional: without it the answer still has today's positions.
    let week: TransitEvent[] = [];
    if (weekR.status === 'fulfilled' && weekR.value.ok) {
      const w = (await weekR.value.json().catch(() => ({}))) as { items?: TransitEvent[] };
      week = (w.items ?? []).filter((e) => e.typ !== 'nakshatra').sort((a, b) => a.dt - b.dt);
    }
    const snapshot: TransitSnapshot = {
      asOfSec: dayStart + DAY / 2,
      planets: (now.pl ?? []).map((p) => ({
        p: p.p,
        r: p.r,
        deg: p.deg,
        min: p.min,
        retro: p.mo === 1,
      })),
      events: (tl.items ?? []).filter((e) => e.typ !== 'nakshatra').sort((a, b) => a.dt - b.dt),
      week,
    };
    if (!snapshot.planets.length) return null;
    await cache?.put(
      key,
      new Response(JSON.stringify(snapshot), { headers: { 'cache-control': 'max-age=86400' } }),
    );
    return snapshot;
  } catch {
    console.error('transit_upstream_unreachable');
    return null;
  }
}

const houseFrom = (sign: number, fromSign: number) => ((sign - fromSign + 12) % 12) + 1;

/** Sign occupancy intervals for one planet over the timeline window. */
export function signIntervals(
  snap: TransitSnapshot,
  planet: number,
  untilSec: number,
): { sign: number; from: number; to: number }[] {
  const now = snap.planets.find((p) => p.p === planet);
  if (!now) return [];
  const out: { sign: number; from: number; to: number }[] = [];
  let sign = now.r;
  let start = snap.asOfSec;
  for (const e of snap.events) {
    if (e.p !== planet || e.typ !== 'rashi' || e.to === undefined || e.dt <= start) continue;
    out.push({ sign, from: start, to: e.dt });
    sign = e.to;
    start = e.dt;
  }
  out.push({ sign, from: start, to: untilSec });
  return out;
}

/** Periods when both Jupiter and Saturn occupy or aspect `house` (from Lagna sign). */
export function doubleTransitWindows(
  snap: TransitSnapshot,
  lagnaSign: number,
  house: number,
): { from: number; to: number }[] {
  const until = snap.asOfSec + YEARS_AHEAD * 365 * DAY;
  const touches = (planet: number, sign: number) => {
    const h = houseFrom(sign, lagnaSign);
    return h === house || aspectedHouses(planet, h).includes(house);
  };
  const jup = signIntervals(snap, 5, until).filter((i) => touches(5, i.sign));
  const sat = signIntervals(snap, 7, until).filter((i) => touches(7, i.sign));
  const out: { from: number; to: number }[] = [];
  for (const j of jup) {
    for (const s of sat) {
      const from = Math.max(j.from, s.from);
      const to = Math.min(j.to, s.to);
      if (to - from > 7 * DAY) {
        const last = out.at(-1);
        if (last && from - last.to < DAY) last.to = Math.max(last.to, to);
        else out.push({ from, to });
      }
    }
  }
  return out;
}

const EVENT_LABEL: Record<string, string> = { retro: 'turns retrograde', direct: 'turns direct' };

/** A fast planet's sign at `atSec`, from today's position and the week's sign changes. */
export function signAt(snap: TransitSnapshot, planet: number, atSec: number): number | null {
  const now = snap.planets.find((p) => p.p === planet);
  if (!now) return null;
  const changes = (snap.week ?? []).filter(
    (e) => e.p === planet && e.typ === 'rashi' && e.to !== undefined,
  );
  if (atSec >= snap.asOfSec) {
    let sign = now.r;
    for (const e of changes) if (e.dt > snap.asOfSec && e.dt <= atSec) sign = e.to!;
    return sign;
  }
  const next = changes.find((e) => e.dt > atSec && e.dt <= snap.asOfSec);
  return next?.from ?? now.r;
}

/** Seconds east of UTC for `tz` at `sec`. */
function zoneOffset(sec: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(sec * 1000));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (
    Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) / 1000 - sec
  );
}

/** Unix seconds of local midnight starting the local day that contains `sec`. */
export function localMidnight(sec: number, tz: string): number {
  const [y, m, d] = isoDateInZone(sec, tz).split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d) / 1000;
  return guess - zoneOffset(guess, tz);
}

/**
 * Day-by-day lines for the next 7 local days: the transiting Moon's sign and
 * houses (it changes sign every ~2.25 days), plus fast-planet sign changes and
 * retrograde/direct turns. Empty when the week data is unavailable.
 */
export function weekLines(
  k: AskPanchangKundali,
  snap: TransitSnapshot,
  tz: string,
  todaySec: number,
): string[] {
  if (!snap.week?.length) return [];
  const lagna = k.info.lagna;
  const moon = k.info.rashi;
  const dayFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const where = (sign: number) =>
    `${signName(sign)} (H${houseFrom(sign, lagna)} from Lagna, H${houseFrom(sign, moon)} from Moon)`;
  const out = ['', `## NEXT 7 DAYS (transiting Moon each day; times in ${tz})`];
  let start = localMidnight(todaySec, tz);
  for (let i = 0; i < 7; i++) {
    // Next local midnight (robust to DST: step 26 h, then snap back to midnight).
    const end = localMidnight(start + 26 * 3600, tz);
    const first = signAt(snap, 2, start);
    if (first === null) return [];
    const changes = snap.week.filter(
      (e) => e.p === 2 && e.typ === 'rashi' && e.to !== undefined && e.dt >= start && e.dt < end,
    );
    out.push(
      `${isoDateInZone(start, tz)} ${dayFmt.format(new Date(start * 1000))}: Moon in ${where(first)}` +
        changes
          .map((e) => `; enters ${where(e.to!)} at ${timeFmt.format(new Date(e.dt * 1000))}`)
          .join(''),
    );
    start = end;
  }
  const horizon = start;
  const others = snap.week.filter(
    (e) => e.p !== 2 && e.dt >= localMidnight(todaySec, tz) && e.dt < horizon,
  );
  for (const e of others) {
    const when = `${isoDateInZone(e.dt, tz)} ${timeFmt.format(new Date(e.dt * 1000))}`;
    if (e.typ === 'rashi' && e.to !== undefined) {
      out.push(`${when} ${planetName(e.p)} enters ${where(e.to)}`);
    } else if (EVENT_LABEL[e.typ]) {
      out.push(`${when} ${planetName(e.p)} ${EVENT_LABEL[e.typ]}`);
    }
  }
  return out;
}

/** Digest lines for live transits relative to this chart. */
export function transitLines(
  k: AskPanchangKundali,
  snap: TransitSnapshot,
  tz: string,
  timeUncertain: boolean,
  /** The moment of the question (defaults to the snapshot time). */
  todaySec?: number,
): string[] {
  const day = (sec: number) => isoDateInZone(sec, tz);
  const lagna = k.info.lagna;
  const moon = k.info.rashi;
  const out: string[] = [];
  out.push('', `## CURRENT TRANSITS (gochar, as of ${day(snap.asOfSec)})`);
  out.push('planet | sign degree | house from Lagna | house from Moon');
  for (const p of [...snap.planets].sort((a, b) => a.p - b.p)) {
    out.push(
      `${planetName(p.p)} | ${signName(p.r)} ${p.deg}°${String(p.min).padStart(2, '0')}′${p.retro ? ' R' : ''} | ` +
        `H${houseFrom(p.r, lagna)} | H${houseFrom(p.r, moon)}`,
    );
  }
  if (timeUncertain) out.push('Birth time unknown: prefer houses from the Moon.');

  out.push(...weekLines(k, snap, tz, todaySec ?? snap.asOfSec));

  const upcoming = snap.events.filter((e) => e.dt > snap.asOfSec);
  if (upcoming.length) {
    out.push('', `## UPCOMING SLOW-PLANET CHANGES (next ${YEARS_AHEAD} years)`);
    for (const e of upcoming.slice(0, 24)) {
      if (e.typ === 'rashi' && e.to !== undefined) {
        out.push(
          `${day(e.dt)} ${planetName(e.p)} enters ${signName(e.to)} (H${houseFrom(e.to, lagna)} from Lagna, H${houseFrom(e.to, moon)} from Moon)`,
        );
      } else if (EVENT_LABEL[e.typ]) {
        out.push(`${day(e.dt)} ${planetName(e.p)} ${EVENT_LABEL[e.typ]}`);
      }
    }
  }

  out.push(
    '',
    `## JUPITER–SATURN DOUBLE TRANSIT (both occupy or aspect the house, from Lagna; next ${YEARS_AHEAD} years)`,
  );
  for (let h = 1; h <= 12; h++) {
    const w = doubleTransitWindows(snap, lagna, h);
    if (w.length) {
      out.push(`H${h}: ${w.map((x) => `${day(x.from)} → ${day(x.to)}`).join('; ')}`);
    }
  }
  out.push(
    `Sade Sati is judged from Saturn's sign relative to the Moon (${signName(moon)}): currently Saturn is ${ordinal(
      houseFrom(snap.planets.find((p) => p.p === 7)?.r ?? moon, moon),
    )} from the Moon.`,
  );
  return out;
}

/** Signs each planet occupies now, this week or during the timeline (for the fact-checker). */
export function transitSignSets(snap: TransitSnapshot | null): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  if (!snap) return out;
  for (const p of snap.planets) out.set(p.p, new Set([p.r]));
  for (const e of [...snap.events, ...(snap.week ?? [])]) {
    if (e.typ === 'rashi' && e.to !== undefined) {
      const set = out.get(e.p) ?? new Set<number>();
      set.add(e.to);
      if (e.from !== undefined) set.add(e.from);
      out.set(e.p, set);
    }
  }
  return out;
}
