export function pct(used: number, limit: number) {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

/** "3 h 12 min" until the next 00:00 UTC reset. */
export function untilReset(resetsAt: string, nowMs: number) {
  const mins = Math.max(0, Math.ceil((new Date(resetsAt).getTime() - nowMs) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

type UsageLike = {
  userLimit: number | null;
  budget: number;
  you: { neurons: number };
  account: { neurons: number };
};

/**
 * The percentage to show a person: their own use against their daily limit,
 * or for admins (no cap) the whole app's use against the free allowance.
 */
export function headlinePercent(u: UsageLike) {
  return u.userLimit === null
    ? { percent: pct(u.account.neurons, u.budget), of: 'the free daily allowance (app total)' }
    : { percent: pct(u.you.neurons, u.userLimit), of: 'your daily allowance' };
}
