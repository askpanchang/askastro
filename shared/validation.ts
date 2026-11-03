/** True if `tz` is an IANA time zone the runtime knows (browser and workerd). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The latest calendar date anywhere on Earth right now (UTC+14), so a birth
 * "today" in any time zone is accepted while real future dates are rejected.
 */
export function latestTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + 14 * 3600_000).toISOString().slice(0, 10);
}

/** "14:30" → "2:30 PM" */
export function to12h(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}
