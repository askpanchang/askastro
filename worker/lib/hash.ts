/** Fields that determine a chart. Name and notes don't change the chart. */
export type ChartInputs = {
  gender: string;
  dob: string;
  tob: string | null;
  tobUnknown: boolean;
  lat: number;
  lon: number;
  tz: string;
};

export type ChartOptions = { ayanamsa: string; chartStyle: string; lang: string };

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash of birth data + chart options. A kundali is stale when the hash of the
 * profile's current birth data (with the kundali's options) differs from the
 * hash stored on the kundali.
 */
export function chartInputHash(p: ChartInputs, o: ChartOptions): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      p.gender,
      p.dob,
      p.tobUnknown ? null : p.tob,
      p.tobUnknown,
      Number(p.lat.toFixed(4)),
      Number(p.lon.toFixed(4)),
      p.tz,
      o.ayanamsa,
      o.chartStyle,
      o.lang,
    ]),
  );
}
