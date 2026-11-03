import type { KundaliStatus } from '../../shared/profile';

const STYLES: Record<KundaliStatus, { label: string; cls: string }> = {
  none: { label: 'No kundali', cls: 'bg-surface-2 text-muted' },
  current: { label: 'Kundali ready', cls: 'bg-teal-soft text-teal' },
  stale: { label: 'Needs regenerating', cls: 'bg-saffron-soft text-amber' },
};

export function KundaliStatusBadge({ status }: { status: KundaliStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}
