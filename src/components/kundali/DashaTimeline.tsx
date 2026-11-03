import { CaretDown } from '@phosphor-icons/react';
import { useState } from 'react';
import { planetName } from '../../../shared/astro';
import { currentDasha, subPeriods } from '../../../shared/dasha';
import type { AskPanchangKundali } from '../../../shared/kundali';
import { dayMonthYear, monthYear } from '../../lib/dates';
import { useNowSec } from '../../lib/useNowSec';

export function DashaTimeline({
  data,
  tz,
  nowSec: nowOverride,
}: {
  data: AskPanchangKundali;
  tz: string;
  nowSec?: number;
}) {
  const now = useNowSec();
  const nowSec = nowOverride ?? now;
  const cur = currentDasha(data, nowSec);
  const [open, setOpen] = useState<number | null>(cur?.md.from ?? null);

  return (
    <div className="space-y-3">
      {cur && (
        <p className="rounded-xl border border-indigo/30 bg-indigo-soft px-4 py-3 text-sm">
          <span className="font-semibold">Now: </span>
          {planetName(cur.md.lord)} mahadasha
          {cur.ad && <> · {planetName(cur.ad.lord)} antardasha</>}
          {cur.pd && (
            <>
              {' '}
              · {planetName(cur.pd.lord)} pratyantardasha (until {dayMonthYear(cur.pd.to, tz)})
            </>
          )}
        </p>
      )}
      <ol className="divide-y divide-border rounded-xl border border-border bg-surface">
        {data.dasha.map((md) => {
          const isCurrent = cur?.md.from === md.from;
          const isOpen = open === md.from;
          const progress = Math.min(1, Math.max(0, (nowSec - md.from) / (md.to - md.from)));
          return (
            <li key={md.from}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : md.from)}
                aria-expanded={isOpen}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-2 ${isCurrent ? 'bg-saffron-soft/60' : ''}`}
              >
                <span className="w-20 font-semibold">{planetName(md.md)}</span>
                <span className="flex-1 text-muted tabular-nums">
                  {monthYear(md.from, tz)} – {monthYear(md.to, tz)}
                </span>
                <span
                  className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-2 sm:block"
                  aria-hidden
                >
                  <span
                    className="block h-full bg-saffron"
                    style={{ width: `${progress * 100}%` }}
                  />
                </span>
                {isCurrent && (
                  <span className="rounded-full bg-saffron px-2 py-0.5 text-xs font-semibold text-on-accent">
                    Current
                  </span>
                )}
                <CaretDown
                  size={14}
                  className={`text-muted transition ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
              {isOpen && (
                <ul className="grid gap-1 bg-bg/50 px-4 py-3 text-sm sm:grid-cols-2">
                  {md.ad.map((ad) => {
                    const adCurrent = cur?.ad?.from === ad.from;
                    return (
                      <li
                        key={ad.from}
                        className={`rounded-lg px-3 py-2 ${adCurrent ? 'bg-saffron-soft font-semibold' : ''}`}
                      >
                        <span>
                          {planetName(md.md)}–{planetName(ad.p)}
                        </span>
                        <span className="block text-xs font-normal text-muted tabular-nums">
                          {dayMonthYear(ad.from, tz)} – {dayMonthYear(ad.to, tz)}
                        </span>
                        {adCurrent && (
                          <span className="mt-1 block text-xs font-normal">
                            Pratyantar:{' '}
                            {subPeriods({ lord: ad.p, from: ad.from, to: ad.to })
                              .filter((p) => p.to > nowSec)
                              .slice(0, 3)
                              .map((p) => `${planetName(p.lord)} to ${dayMonthYear(p.to, tz)}`)
                              .join(' · ')}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
