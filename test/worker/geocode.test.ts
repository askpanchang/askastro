import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '../../shared/api';
import { GeocodeResponseSchema } from '../../shared/geocode';
import { api } from './helpers';

const OPEN_METEO_SAMPLE = {
  results: [
    {
      id: 1269843,
      name: 'Hyderabad',
      latitude: 17.38405,
      longitude: 78.45636,
      timezone: 'Asia/Kolkata',
      country: 'India',
      country_code: 'IN',
      admin1: 'Telangana',
    },
    { id: 2, name: 'Nowhere', latitude: 1, longitude: 2 }, // no timezone → dropped
  ],
};

describe('GET /api/geocode', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps Open-Meteo results and caches them', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(OPEN_METEO_SAMPLE));
    const q = `Hyderabad-${crypto.randomUUID().slice(0, 6)}`;

    const res = await api(`/api/geocode?q=${q}`);
    expect(res.status).toBe(200);
    const body = GeocodeResponseSchema.parse(await res.json());
    expect(body.results).toEqual([
      {
        id: '1269843',
        name: 'Hyderabad',
        admin1: 'Telangana',
        country: 'India',
        countryCode: 'IN',
        label: 'Hyderabad, Telangana, India',
        lat: 17.38405,
        lon: 78.45636,
        tz: 'Asia/Kolkata',
      },
    ]);
    const url = new URL(String(spy.mock.calls[0]?.[0]));
    expect(url.hostname).toBe('geocoding-api.open-meteo.com');
    expect(url.searchParams.get('name')).toBe(q);

    // Second call (different case/spacing) is served from cache.
    await vi.waitFor(async () => {
      const again = await api(`/api/geocode?q=${q.toUpperCase()}`);
      expect(GeocodeResponseSchema.parse(await again.json()).results).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it('validates the query', async () => {
    const res = await api('/api/geocode?q=a');
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('maps upstream failures to a clean error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('x', { status: 500 }),
    );
    const res = await api(`/api/geocode?q=fail-${crypto.randomUUID().slice(0, 6)}`);
    expect(res.status).toBe(502);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('GEOCODE_UPSTREAM_ERROR');
  });
});
