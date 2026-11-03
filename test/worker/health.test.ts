import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, HealthSchema } from '../../shared/api';

describe('GET /api/health', () => {
  it('reports ok with a working D1 binding', async () => {
    const res = await exports.default.fetch('https://example.com/api/health');
    expect(res.status).toBe(200);
    const body = HealthSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'ok', db: 'ok', app: 'Kundali Studio' });
  });

  it('returns the standard error shape for unknown API routes', async () => {
    const res = await exports.default.fetch('https://example.com/api/nope');
    expect(res.status).toBe(404);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
