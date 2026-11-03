import { dms, nakshatraName, planetName, signName, signSanskrit } from '../../../shared/astro';
import { currentDasha } from '../../../shared/dasha';
import type { AskPanchangKundali } from '../../../shared/kundali';
import { dayMonthYear } from '../../lib/dates';
import { useNowSec } from '../../lib/useNowSec';

export function KundaliSummary({ data, tz }: { data: AskPanchangKundali; tz: string }) {
  const sun = data.pl.find((p) => p.p === 1);
  const cur = currentDasha(data, useNowSec());
  const rows: [string, string][] = [
    [
      'Lagna',
      `${signName(data.info.lagna)} (${signSanskrit(data.info.lagna)}) ${dms(data.info.asc_deg, data.info.asc_min)}`,
    ],
    ['Moon sign', `${signName(data.info.rashi)} (${signSanskrit(data.info.rashi)})`],
    ['Nakshatra', `${nakshatraName(data.info.n)}, pada ${data.info.pd}`],
    ['Sun sign', sun ? `${signName(sun.r)} (${signSanskrit(sun.r)})` : '—'],
    [
      'Current dasha',
      cur
        ? [cur.md, cur.ad, cur.pd]
            .filter(Boolean)
            .map((p) => planetName(p!.lord))
            .join(' / ') + (cur.ad ? ` (AD until ${dayMonthYear(cur.ad.to, tz)})` : '')
        : '—',
    ],
  ];
  return (
    <dl className="divide-y divide-border rounded-xl border border-border bg-surface">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
