import { to12h } from '../../shared/validation';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "1990-08-15" → "15 Aug 1990" */
export function formatDob(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

/** "14:30" → "14:30 (2:30 PM)" */
export function formatTob(tob: string | null, unknown: boolean): string {
  if (unknown || !tob) return 'Time unknown';
  return `${tob} (${to12h(tob)})`;
}

const relFmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** ISO timestamp → "3 days ago" */
export function formatRelative(iso: string, now = Date.now()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return relFmt.format(diffSec, 'second');
  if (abs < 3600) return relFmt.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return relFmt.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return relFmt.format(Math.round(diffSec / 86400), 'day');
  return dateFmt.format(new Date(iso));
}
