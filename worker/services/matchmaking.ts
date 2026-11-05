/**
 * Ashtakoota (Guna Milan) compatibility from AskPanchang:
 * POST /api/v1/matchmaking/analyze { a, b, opt: { ayan } } → score/36, the
 * eight kootas, dosha comparisons (Manglik, Nadi, Bhakoot, Sade Sati …),
 * planet and life-area compatibility. `a` is the groom and `b` the bride in
 * the traditional method. The `reco` text is left out: it can contradict the
 * dosha table (e.g. on mutual Manglik cancellation).
 */

export type MatchBirth = {
  nm: string;
  g: string;
  dob: string;
  tob: string;
  tz: string;
  lat: number;
  lon: number;
  loc: string;
};

type Koota = {
  k: string;
  score: number;
  max: number;
  av?: string;
  bv?: string;
  sig?: string;
  why?: string;
};
type DoshaRow = { title: string; av?: string; bv?: string; verdict?: string };
type Scored = { title?: string; label?: string; pct?: number; grade?: string; txt?: string };
export type MatchResult = {
  score: number;
  max: number;
  gradeLabel?: string;
  verdict?: string;
  guna?: Koota[];
  nadiNote?: string | null;
  dosha?: DoshaRow[];
  planets?: Scored[];
  life?: Scored[];
};

const DAY = 86_400;

export async function fetchMatch(
  env: Pick<Env, 'ASKPANCHANG_API_BASE'>,
  a: MatchBirth,
  b: MatchBirth,
  ayanamsa: string,
  fetcher?: typeof fetch,
): Promise<MatchResult | null> {
  const body = JSON.stringify({ a, b, opt: { ayan: ayanamsa, lang: 'en' } });
  const key = new Request(
    `https://match-cache.internal/v1?h=${encodeURIComponent(await sha256(body))}`,
  );
  const cache = typeof caches !== 'undefined' ? await caches.open('matchmaking') : null;
  const hit = await cache?.match(key);
  if (hit) return (await hit.json()) as MatchResult;
  try {
    const res = await (fetcher ?? fetch)(
      `${env.ASKPANCHANG_API_BASE.replace(/\/+$/, '')}/api/v1/matchmaking/analyze`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      console.error('match_upstream_status', res.status);
      return null;
    }
    const data = (await res.json()) as MatchResult;
    if (typeof data.score !== 'number') return null;
    // Sade Sati status in the result changes over time: cache for a day.
    await cache?.put(
      key,
      new Response(JSON.stringify(data), { headers: { 'cache-control': `max-age=${DAY}` } }),
    );
    return data;
  } catch {
    console.error('match_upstream_unreachable');
    return null;
  }
}

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Context lines for the model, with the API's Boy/Girl labels replaced by names. */
export function matchLines(m: MatchResult, aName: string, bName: string, note?: string): string[] {
  const names = (t: string | undefined) =>
    (t ?? '')
      .replace(/\bBoy's\b/g, `${aName}'s`)
      .replace(/\bGirl's\b/g, `${bName}'s`)
      .replace(/\bBoy\b(?: \(A\))?/g, aName)
      .replace(/\bGirl\b(?: \(B\))?/g, bName);
  const out = [
    '',
    `## COMPATIBILITY (Ashtakoota Guna Milan, computed by AskPanchang; ${aName} as groom, ${bName} as bride)`,
  ];
  if (note) out.push(note);
  out.push(
    `Total: ${m.score}/${m.max}${m.gradeLabel ? ` (${m.gradeLabel})` : ''}${m.verdict ? ` — ${names(m.verdict)}` : ''}`,
  );
  for (const g of m.guna ?? []) {
    out.push(
      `${g.k}: ${g.score}/${g.max} (${aName}: ${g.av ?? '?'}, ${bName}: ${g.bv ?? '?'}) — ${g.sig ?? ''}; ${names(g.why)}`,
    );
  }
  if (m.nadiNote) out.push(`Nadi note: ${names(m.nadiNote)}`);
  if (m.dosha?.length) {
    out.push('Doshas compared:');
    for (const d of m.dosha)
      out.push(
        `- ${d.title}: ${aName} ${d.av ?? '?'}; ${bName} ${d.bv ?? '?'} → ${names(d.verdict)}`,
      );
  }
  const scored = (title: string, rows: Scored[] | undefined) => {
    if (!rows?.length) return;
    out.push(`${title}:`);
    for (const r of rows)
      out.push(`- ${r.title ?? r.label}: ${r.pct ?? '?'}% (${r.grade ?? ''}) — ${names(r.txt)}`);
  };
  scored('Planet compatibility', m.planets);
  scored('Life areas', m.life);
  return out;
}
