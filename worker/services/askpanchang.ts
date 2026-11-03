import {
  AskPanchangKundaliSchema,
  type AskPanchangKundali,
  type KundaliOptions,
} from '../../shared/kundali';
import type { Profile } from '../../shared/profile';
import { AppError } from '../lib/errors';

/** Exact request body sent to POST /api/v1/kundali/generate. */
export type KundaliRequest = {
  bd: {
    nm: string;
    g: 'm' | 'f' | 'o';
    dob: string;
    tob: string;
    tz: string;
    lat: number;
    lon: number;
    loc: string;
  };
  opt: { ayan: string; chart: string; lang: string };
};

/** Birth time used when the real time is unknown (BUILD_PROMPT §7.1). */
export const UNKNOWN_TIME_FALLBACK = '12:00';

export function buildKundaliRequest(p: Profile, o: KundaliOptions): KundaliRequest {
  return {
    bd: {
      nm: p.name,
      g: p.gender,
      dob: p.dob,
      tob: p.tobUnknown || !p.tob ? UNKNOWN_TIME_FALLBACK : p.tob,
      tz: p.tz,
      lat: p.lat,
      lon: p.lon,
      loc: p.place,
    },
    opt: { ayan: o.ayanamsa, chart: o.chartStyle, lang: o.lang },
  };
}

export type KundaliResult = {
  /** Parsed, validated response. */
  data: AskPanchangKundali;
  /** Response body exactly as received, for storage. */
  raw: string;
};

export interface KundaliClient {
  generate(req: KundaliRequest): Promise<KundaliResult>;
}

const TIMEOUT_MS = 15_000;
const upstream = () =>
  new AppError(
    502,
    'KUNDALI_UPSTREAM_ERROR',
    'The kundali service is unavailable right now. Please try again.',
  );

export class AskPanchangClient implements KundaliClient {
  constructor(
    private readonly env: Pick<
      Env,
      'ASKPANCHANG_API_BASE' | 'ASKPANCHANG_API_KEY' | 'ASKPANCHANG_API_KEY_HEADER'
    >,
    private readonly fetcher?: typeof fetch,
  ) {}

  async generate(req: KundaliRequest): Promise<KundaliResult> {
    const url = `${this.env.ASKPANCHANG_API_BASE.replace(/\/+$/, '')}/api/v1/kundali/generate`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.env.ASKPANCHANG_API_KEY) {
      headers[this.env.ASKPANCHANG_API_KEY_HEADER || 'x-api-key'] = this.env.ASKPANCHANG_API_KEY;
    }
    const body = JSON.stringify(req);

    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await (this.fetcher ?? fetch)(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        res = null; // network error or timeout → retry once
        continue;
      }
      if (res.status < 500) break;
    }
    if (!res) throw upstream();
    if (res.status === 400 || res.status === 422) {
      throw new AppError(
        422,
        'KUNDALI_INVALID_INPUT',
        "The kundali service couldn't use these birth details. Check the date, time and place.",
      );
    }
    if (!res.ok) throw upstream();

    const raw = await res.text().catch(() => '');
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* handled below */
    }
    const parsed = AskPanchangKundaliSchema.safeParse(json);
    if (!parsed.success) {
      console.error('kundali_unexpected_response', parsed.error.issues.length);
      throw upstream();
    }
    return { data: parsed.data, raw };
  }
}
