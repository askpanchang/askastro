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
export type TransitSnapshot = { asOfSec: number; planets: TransitPlanet[]; events: TransitEvent[] };

const SLOW = [5, 7, 8, 9]; // Jupiter, Saturn, Rahu, Ketu
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
  const key = new Request(`https://transit-cache.internal/v1?d=${dayStart}&a=${ayanamsa}`);
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
    const [nowR, tlR] = await Promise.allSettled([
      post('/api/v1/planets/transit', { l: DEFAULT_LOC, dt: dayStart + DAY / 2, ayan: ayanamsa }),
      post('/api/v1/planets/timeline', {
        l: DEFAULT_LOC,
        from: dayStart,
        to: dayStart + YEARS_AHEAD * 365 * DAY,
        pl: SLOW,
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

/** Digest lines for live transits relative to this chart. */
export function transitLines(
  k: AskPanchangKundali,
  snap: TransitSnapshot,
  tz: string,
  timeUncertain: boolean,
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
