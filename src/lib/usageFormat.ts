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
