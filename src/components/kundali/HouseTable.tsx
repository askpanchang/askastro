import { planetName, signName } from '../../../shared/astro';
import type { AskPanchangKundali } from '../../../shared/kundali';

export function HouseTable({ data }: { data: AskPanchangKundali }) {
  const houses = [...data.houses].sort((a, b) => a.h - b.h);
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">Houses</caption>
        <thead className="border-b border-border bg-surface-2 text-xs text-muted uppercase">
          <tr>
            {['House', 'Sign', 'Lord', 'Lord placed in', 'Occupants', 'SAV'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {houses.map((h) => (
            <tr key={h.h}>
              <th scope="row" className="px-3 py-2 font-semibold tabular-nums">
                {h.h}
              </th>
              <td className="px-3 py-2">{signName(h.r)}</td>
              <td className="px-3 py-2">{planetName(h.lord)}</td>
              <td className="px-3 py-2 tabular-nums">{h.lh ? `House ${h.lh}` : '—'}</td>
              <td className="px-3 py-2">{h.p.length ? h.p.map(planetName).join(', ') : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{h.sav ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
