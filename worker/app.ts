import { Hono } from 'hono';
import type { Health } from '../shared/api';
import { AppError, errorBody } from './lib/errors';

export type AppEnv = { Bindings: Env };

export function createApp() {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  api.get('/health', async (c) => {
    let db: 'ok' | 'error' = 'ok';
    try {
      await c.env.DB.prepare('SELECT 1').first();
    } catch {
      db = 'error';
    }
    const body: Health = {
      status: 'ok',
      app: c.env.APP_NAME,
      db,
      time: new Date().toISOString(),
    };
    return c.json(body, db === 'ok' ? 200 : 503);
  });

  api.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));

  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(errorBody(err.code, err.message, err.details), err.status);
    }
    // Log only the error type/message, never request bodies (personal data).
    console.error('unhandled_error', err instanceof Error ? err.name : 'unknown');
    return c.json(errorBody('INTERNAL_ERROR', 'Something went wrong'), 500);
  });

  // Only /api/* reaches the Worker (assets.run_worker_first); everything else
  // is served by static assets with SPA fallback.
  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));

  return app;
}
