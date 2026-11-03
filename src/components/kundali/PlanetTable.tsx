import { dignityName, dms, nakshatraName, planetName, signName } from '../../../shared/astro';
import type { AskPanchangKundali } from '../../../shared/kundali';

const DIGNITY_TONE: Record<number, string> = {
  1: 'text-teal',
  2: 'text-teal',
  6: 'text-teal',
  3: 'text-danger',
  5: 'text-amber',
};

export function PlanetTable({ data }: { data: AskPanchangKundali }) {
  const bala = new Map(data.shadbala.map((s) => [s.p, s.ratio]));
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <caption className="sr-only">Planetary positions</caption>
        <thead className="border-b border-border bg-surface-2 text-xs text-muted uppercase">
          <tr>
            {[
              'Planet',
              'Sign',
              'Degree',
              'House',
              'Nakshatra',
              'Dignity',
              'Notes',
              'D9',
              'Strength',
            ].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.pl.map((p) => {
            const notes = [p.rx ? 'Retrograde' : null, p.cmb ? 'Combust' : null, ...p.fl].filter(
              Boolean,
            );
            const ratio = bala.get(p.p);
            return (
              <tr key={p.p}>
                <th scope="row" className="px-3 py-2 font-semibold">
                  {planetName(p.p)}
                </th>
                <td className="px-3 py-2">{signName(p.r)}</td>
                <td className="px-3 py-2 tabular-nums">{dms(p.deg, p.min)}</td>
                <td className="px-3 py-2 tabular-nums">{p.h}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {nakshatraName(p.n)} {p.pd}
                  {p.nl ? <span className="text-muted"> · {planetName(p.nl)}</span> : null}
                </td>
                <td
                  className={`px-3 py-2 ${p.dig !== undefined ? (DIGNITY_TONE[p.dig] ?? '') : ''}`}
                >
                  {p.dig !== undefined ? dignityName(p.dig) : '—'}
                </td>
                <td className="px-3 py-2 text-muted capitalize">{notes.join(', ') || '—'}</td>
                <td className="px-3 py-2">{p.r9 ? signName(p.r9) : '—'}</td>
                <td className="px-3 py-2 tabular-nums">
                  {ratio !== undefined ? `${ratio.toFixed(2)}×` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
