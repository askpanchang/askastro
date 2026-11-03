import { CheckCircle, Circle, Warning } from '@phosphor-icons/react';
import type { AskPanchangKundali } from '../../../shared/kundali';

const humanize = (id: string) =>
  id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const DOSHA_NAMES: Record<string, string> = {
  manglik: 'Manglik (Mangal Dosha)',
  kaalsarp: 'Kaal Sarp Dosha',
  pitru: 'Pitru Dosha',
  sade_sati: 'Sade Sati',
};

export function YogaDoshaList({ data }: { data: AskPanchangKundali }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Yogas</h3>
        {data.yogas.length === 0 ? (
          <p className="text-sm text-muted">No yogas reported.</p>
        ) : (
          <ul className="space-y-2">
            {data.yogas.map((y) => (
              <li key={y.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle size={16} className="text-teal" aria-hidden />
                  {humanize(y.id)} yoga
                </p>
                <p className="mt-1 text-muted">{y.txt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Doshas</h3>
        <ul className="space-y-2">
          {data.dosha.map((d) => (
            <li key={d.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                {d.val ? (
                  <Warning size={16} className="text-amber" aria-hidden />
                ) : (
                  <Circle size={16} className="text-muted" aria-hidden />
                )}
                {DOSHA_NAMES[d.id] ?? humanize(d.id)}
                <span className="font-normal text-muted">{d.val ? 'present' : 'absent'}</span>
              </p>
              <p className="mt-1 text-muted">{d.txt}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
