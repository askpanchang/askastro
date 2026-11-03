import type { Place } from '../../shared/geocode';
import { AppError } from '../lib/errors';

/** Swappable place search (e.g. for an AskPanchang place endpoint later). */
export interface Geocoder {
  search(query: string, lang: string): Promise<Place[]>;
}

type OpenMeteoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
};

const OPEN_METEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export class OpenMeteoGeocoder implements Geocoder {
  constructor(private readonly fetcher?: typeof fetch) {}

  async search(query: string, lang: string): Promise<Place[]> {
    const url = new URL(OPEN_METEO_URL);
    url.searchParams.set('name', query);
    url.searchParams.set('count', '10');
    url.searchParams.set('language', lang);
    url.searchParams.set('format', 'json');

    let res: Response;
    try {
      res = await (this.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new AppError(502, 'GEOCODE_UPSTREAM_ERROR', 'Place search is unavailable right now');
    }
    if (!res.ok) {
      throw new AppError(502, 'GEOCODE_UPSTREAM_ERROR', 'Place search is unavailable right now');
    }
    const data = (await res.json().catch(() => ({}))) as { results?: OpenMeteoResult[] };
    return (data.results ?? [])
      .filter((r) => r.timezone && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
      .map((r) => ({
        id: String(r.id),
        name: r.name,
        admin1: r.admin1 ?? null,
        country: r.country ?? null,
        countryCode: r.country_code ?? null,
        label: [r.name, r.admin1, r.country]
          .filter((x, i, a) => x && a.indexOf(x) === i)
          .join(', '),
        lat: r.latitude,
        lon: r.longitude,
        tz: r.timezone as string,
      }));
  }
}
