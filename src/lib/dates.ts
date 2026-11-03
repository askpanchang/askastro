const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: tz });
    cache.set(key, f);
  }
  return f;
}

/** Unix seconds → "Feb 2017" in the given zone. */
export const monthYear = (sec: number, tz: string) =>
  fmt(tz, { month: 'short', year: 'numeric' }).format(new Date(sec * 1000));

/** Unix seconds → "20 Feb 2017" in the given zone. */
export const dayMonthYear = (sec: number, tz: string) =>
  fmt(tz, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(sec * 1000));

/** ISO timestamp → "3 Nov 2026, 10:32" in the viewer's zone. */
export const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
