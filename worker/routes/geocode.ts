import { Hono } from 'hono';
import { GeocodeQuerySchema, type GeocodeResponse } from '../../shared/geocode';
import { parseQuery } from '../lib/validate';
import { OpenMeteoGeocoder, type Geocoder } from '../services/geocoder';
import type { AppEnv } from '../types';

const CACHE_SECONDS = 24 * 60 * 60;

export function geocodeRoutes(geocoder: Geocoder = new OpenMeteoGeocoder()) {
  return new Hono<AppEnv>().get('/', async (c) => {
    const { q, lang } = parseQuery(c, GeocodeQuerySchema);
    const normalized = q.toLowerCase().replace(/\s+/g, ' ');
    // Synthetic cache key: results don't depend on the owner or request host.
    const cacheKey = new Request(
      `https://geocode-cache.internal/v1?lang=${lang}&q=${encodeURIComponent(normalized)}`,
    );
    const cache = await caches.open('geocode');
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, hit);

    const body: GeocodeResponse = { results: await geocoder.search(q, lang) };
    const res = c.json(body, 200, { 'cache-control': `public, max-age=${CACHE_SECONDS}` });
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  });
}
