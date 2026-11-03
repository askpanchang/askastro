import { VIMSHOTTARI_ORDER, VIMSHOTTARI_YEARS } from './astro';
import type { AskPanchangKundali } from './kundali';

/** A dasha period; times are Unix seconds, `to` is exclusive. */
export type Period = { lord: number; from: number; to: number };

const contains = (p: { from: number; to: number }, t: number) => t >= p.from && t < p.to;

/**
 * Sub-periods of a period under Vimshottari rules: they start with the
 * period's own lord, follow the Vimshottari order and are proportional to
 * each lord's mahadasha length. Used for pratyantardashas, which the API
 * names (dasha_now.pd) but doesn't date.
 */
export function subPeriods(parent: Period): Period[] {
  const start = VIMSHOTTARI_ORDER.indexOf(parent.lord as (typeof VIMSHOTTARI_ORDER)[number]);
  if (start < 0) return [];
  const span = parent.to - parent.from;
  const out: Period[] = [];
  let t = parent.from;
  for (let i = 0; i < VIMSHOTTARI_ORDER.length; i++) {
    const lord = VIMSHOTTARI_ORDER[(start + i) % VIMSHOTTARI_ORDER.length] as number;
    const len = (span * (VIMSHOTTARI_YEARS[lord] ?? 0)) / 120;
    const to = i === VIMSHOTTARI_ORDER.length - 1 ? parent.to : t + len;
    out.push({ lord, from: t, to });
    t = to;
  }
  return out;
}

export type CurrentDasha = {
  md: Period;
  ad: Period | null;
  pd: Period | null;
};

/** Mahadasha / antardasha / pratyantardasha running at `atSec` (Unix seconds). */
export function currentDasha(k: AskPanchangKundali, atSec: number): CurrentDasha | null {
  const md = k.dasha.find((m) => contains(m, atSec));
  if (!md) return null;
  const adRaw = md.ad.find((a) => contains(a, atSec));
  const ad = adRaw ? { lord: adRaw.p, from: adRaw.from, to: adRaw.to } : null;
  const pd = ad ? (subPeriods(ad).find((p) => contains(p, atSec)) ?? null) : null;
  return { md: { lord: md.md, from: md.from, to: md.to }, ad, pd };
}

/** All antardashas flattened in time order. */
export function allAntardashas(k: AskPanchangKundali): (Period & { md: number })[] {
  return k.dasha.flatMap((m) => m.ad.map((a) => ({ md: m.md, lord: a.p, from: a.from, to: a.to })));
}

/** Unix seconds → YYYY-MM-DD in the given IANA zone. */
export function isoDateInZone(sec: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(sec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
