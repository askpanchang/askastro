import {
  GANA,
  KARANA,
  LUNAR_MONTH,
  NADI,
  NITYA_YOGA,
  PAKSHA,
  SAMVATSARA,
  TITHI,
  WEEKDAY,
  YONI,
  dignityName,
  dms,
  nakshatraName,
  ordinal,
  planetName,
  signName,
  signSanskrit,
} from '../../shared/astro';
import { allAntardashas, currentDasha, isoDateInZone, subPeriods } from '../../shared/dasha';
import { AYANAMSA_LABELS, type AskPanchangKundali } from '../../shared/kundali';
import { GENDER_LABELS, type Profile } from '../../shared/profile';
import { chartFactLines } from './chartFacts';
import { transitLines, type TransitSnapshot } from './transits';

export type DigestInput = {
  data: AskPanchangKundali;
  profile: Pick<Profile, 'name' | 'gender' | 'dob' | 'tob' | 'tobUnknown' | 'place' | 'tz'>;
  timeUncertain: boolean;
  /** Reference time (Unix seconds) for "current" dasha, sade sati and transits. */
  asOfSec: number;
  /** Live transits at question time; without them the generation-day snapshot is used. */
  transits?: TransitSnapshot | null;
};

const sign = (code: number) => `${signName(code)} (${signSanskrit(code)})`;
const coord = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`;
const clip = (s: string, max = 220) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const label = (t: Readonly<Record<number, string>>, code: number | undefined) =>
  code === undefined ? null : (t[code] ?? null);

/**
 * Converts the raw AskPanchang kundali into a compact, deterministic text
 * block used as LLM context (BUILD_PROMPT §9.1). Same input → same output.
 */
export function buildChartDigest({
  data: k,
  profile,
  timeUncertain,
  asOfSec,
  transits,
}: DigestInput): string {
  const tz = profile.tz;
  const day = (sec: number) => isoDateInZone(sec, tz);
  const asOf = day(asOfSec);
  const out: string[] = [];
  const section = (title: string) => out.push('', `## ${title}`);

  /* Birth */
  out.push('## BIRTH');
  out.push(
    `Name: ${profile.name} | Gender: ${GENDER_LABELS[profile.gender]} | DOB: ${profile.dob} | ` +
      `TOB: ${profile.tobUnknown ? 'UNKNOWN' : `${profile.tob} local time`} | Time zone: ${tz}`,
  );
  out.push(
    `Place: ${profile.place} (${coord(k.info.lat, 'N', 'S')}, ${coord(k.info.lon, 'E', 'W')})`,
  );
  const ayanLabel = AYANAMSA_LABELS[k.info.ayan as keyof typeof AYANAMSA_LABELS] ?? k.info.ayan;
  out.push(
    `Zodiac: sidereal | Ayanamsa: ${ayanLabel}${k.info.ayan_val ? ` (${k.info.ayan_val.toFixed(4)}°)` : ''}` +
      `${k.info.node ? ` | Nodes: ${k.info.node}` : ''} | House system: whole sign`,
  );
  if (timeUncertain) {
    out.push(
      'TIME-UNCERTAIN: birth time unknown; chart cast for 12:00 noon. Ascendant, houses, house lords, ' +
        'divisional-chart lagnas and Moon degree/nakshatra may be wrong. Prefer Moon-sign and planet-in-sign analysis.',
    );
  }
  const b = k.birth;
  if (b) {
    const parts = [
      label(WEEKDAY, b.w),
      // Tithi labels already include the paksha ("Krishna Dashami").
      label(TITHI, b.t) ?? label(PAKSHA, b.pk),
      label(NITYA_YOGA, b.y) && `${label(NITYA_YOGA, b.y)} yoga`,
      label(KARANA, b.k) && `${label(KARANA, b.k)} karana`,
      label(LUNAR_MONTH, b.ma) && `${label(LUNAR_MONTH, b.ma)} month`,
      label(SAMVATSARA, b.sv) && `${label(SAMVATSARA, b.sv)} samvatsara`,
    ].filter(Boolean);
    if (parts.length) out.push(`Birth panchang: ${parts.join(', ')}`);
  }

  /* Key points */
  section('KEY POINTS');
  out.push(`Lagna (ascendant): ${sign(k.info.lagna)} ${dms(k.info.asc_deg, k.info.asc_min)}`);
  const moon = k.pl.find((p) => p.p === 2);
  const sun = k.pl.find((p) => p.p === 1);
  out.push(
    `Moon sign (rashi): ${sign(k.info.rashi)} | Janma nakshatra: ${nakshatraName(k.info.n)} pada ${k.info.pd}` +
      (moon ? ` | Moon in ${ordinal(moon.h)} house` : ''),
  );
  if (sun) out.push(`Sun sign: ${sign(sun.r)} | Sun in ${ordinal(sun.h)} house`);
  const av = k.avak;
  if (av) {
    const a = [
      label(GANA, av.gana) && `Gana ${label(GANA, av.gana)}`,
      label(NADI, av.nadi) && `Nadi ${label(NADI, av.nadi)}`,
      label(YONI, av.yoni) && `Yoni ${label(YONI, av.yoni)}`,
    ].filter(Boolean);
    if (a.length) out.push(a.join(' | '));
  }
  if (k.karakas?.items.length) {
    out.push(
      `Chara karakas (Jaimini): ${k.karakas.items.map((c) => `${c.k} ${planetName(c.p)}`).join(', ')}` +
        (k.karakas.karakamsa ? ` | Karakamsa: ${signName(k.karakas.karakamsa)}` : ''),
    );
  }

  /* Planets */
  section('PLANETS (D1)');
  out.push(
    'planet | sign degree | house | nakshatra-pada (lord) | dignity | flags | D9 sign | shadbala',
  );
  const bala = new Map(k.shadbala.map((s) => [s.p, s]));
  for (const p of k.pl) {
    const flags = [p.rx ? 'retrograde' : null, p.cmb ? 'combust' : null, ...p.fl].filter(Boolean);
    const sb = bala.get(p.p);
    out.push(
      [
        planetName(p.p),
        `${signName(p.r)} ${dms(p.deg, p.min)}`,
        `H${p.h}`,
        `${nakshatraName(p.n)}-${p.pd}${p.nl ? ` (${planetName(p.nl)})` : ''}`,
        p.dig === undefined ? '—' : dignityName(p.dig),
        flags.length ? flags.join(', ') : '—',
        p.r9 ? signName(p.r9) : '—',
        sb?.ratio !== undefined ? `${sb.ratio.toFixed(2)}× required` : '—',
      ].join(' | '),
    );
  }
  if (k.shadbala.some((s) => s.ratio !== undefined)) {
    const ranked = [...k.shadbala]
      .filter((s) => s.ratio !== undefined)
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
    out.push(
      `Shadbala ranking (strongest → weakest; Rahu/Ketu not rated): ${ranked.map((s) => planetName(s.p)).join(' > ')}`,
    );
  }

  /* Houses */
  section('HOUSES (whole sign)');
  out.push('house | sign | lord → placed in | occupants | SAV bindus');
  for (const h of [...k.houses].sort((a, b) => a.h - b.h)) {
    out.push(
      [
        `H${h.h}`,
        signName(h.r),
        `${planetName(h.lord)}${h.lh ? ` → H${h.lh}` : ''}`,
        h.p.length ? h.p.map(planetName).join(', ') : '—',
        h.sav ?? '—',
      ].join(' | '),
    );
  }

  /* Computed facts: lordships, aspects onto houses, karakas, Chalit, from Moon */
  out.push(...chartFactLines(k));

  /* Aspects */
  if (k.aspects.length) {
    section('GRAHA DRISHTI (planet → planet, aspect number)');
    out.push(
      k.aspects
        .map((a) => `${planetName(a.a)} → ${planetName(a.b)} (${ordinal(a.typ)})`)
        .join('; '),
    );
  }

  /* Divisional charts */
  const divisional = ['D9', 'D10'].filter((c) => k.charts[c]?.length === 12);
  if (divisional.length) {
    section('DIVISIONAL CHARTS');
    for (const c of divisional) {
      const cells = k.charts[c] ?? [];
      const asc = cells.find((x) => x.asc);
      const placements = cells
        .flatMap((x) => x.p.map((p) => `${planetName(p)} ${signName(x.r)} (H${x.h})`))
        .join(', ');
      const name = c === 'D9' ? 'D9 Navamsa' : 'D10 Dasamsa';
      out.push(`${name}: Lagna ${asc ? signName(asc.r) : '?'}; ${placements}`);
    }
  }

  /* Dasha */
  section(`VIMSHOTTARI DASHA (as of ${asOf})`);
  const cur = currentDasha(k, asOfSec);
  if (cur) {
    const fmt = (p: { lord: number; from: number; to: number }, kind: string) =>
      `${planetName(p.lord)} ${kind} ${day(p.from)} → ${day(p.to)}`;
    out.push(
      `Current: ${[fmt(cur.md, 'MD'), cur.ad && fmt(cur.ad, 'AD'), cur.pd && fmt(cur.pd, 'PD')]
        .filter(Boolean)
        .join(' / ')}`,
    );
    const ad = cur.ad;
    if (ad) {
      const nextPd = subPeriods(ad).filter((p) => p.from >= (cur.pd?.to ?? ad.from));
      if (nextPd.length) {
        out.push(
          `Next pratyantardashas: ${nextPd
            .slice(0, 3)
            .map((p) => `${planetName(p.lord)} from ${day(p.from)}`)
            .join(', ')}`,
        );
      }
    }
    const nextAds = allAntardashas(k)
      .filter((a) => a.from >= (cur.ad?.to ?? cur.md.to))
      .slice(0, 5);
    if (nextAds.length) {
      out.push(
        `Next antardashas: ${nextAds
          .map((a) => `${planetName(a.md)}-${planetName(a.lord)} ${day(a.from)} → ${day(a.to)}`)
          .join('; ')}`,
      );
    }
  } else {
    out.push('Current period: outside the dasha range returned by the API.');
  }
  out.push(
    `Mahadasha sequence: ${k.dasha.map((m) => `${planetName(m.md)} ${day(m.from).slice(0, 7)}→${day(m.to).slice(0, 7)}`).join(', ')}`,
  );

  /* Yogas and doshas */
  if (k.yogas.length) {
    section('YOGAS (reported by the API)');
    for (const y of k.yogas) out.push(`- ${y.id}: ${clip(y.txt)}`);
  }
  if (k.dosha.length) {
    section('DOSHAS (as of chart generation)');
    for (const d of k.dosha) {
      out.push(`- ${d.id}: ${d.val ? 'PRESENT' : 'absent'}. ${clip(d.txt)}`);
    }
  }

  /* Sade sati windows */
  const saturnCycles = k.ss.filter((s) => s.kind === 'sade_sati' || s.kind === 'panoti');
  if (saturnCycles.length) {
    section(`SATURN CYCLES (Sade Sati / Panoti; status as of ${asOf})`);
    const now = saturnCycles.find((s) => asOfSec >= s.from && asOfSec < s.to);
    const next = saturnCycles.filter((s) => s.from > asOfSec && s.kind === 'sade_sati')[0];
    out.push(
      `Now: ${now ? `${now.kind.replace('_', ' ')}${now.ph ? ` (${now.ph})` : ''} ${day(now.from)} → ${day(now.to)}` : 'none running'}` +
        (next ? ` | Next Sade Sati phase: ${next.ph ?? ''} from ${day(next.from)}` : ''),
    );
  }

  /* Transits: live at question time when available, else the generation-day snapshot */
  if (transits) {
    out.push(...transitLines(k, transits, tz, timeUncertain, asOfSec));
  } else if (k.transits.length) {
    section('SLOW-PLANET TRANSITS (at chart generation; may have moved since)');
    out.push(
      k.transits
        .map((t) => `${planetName(t.p)} in ${signName(t.r)}${t.h ? ` (H${t.h} from lagna)` : ''}`)
        .join('; '),
    );
  }

  return out.join('\n').trim();
}
