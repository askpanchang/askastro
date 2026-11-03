import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Health } from '../shared/api';
import { AppError, errorBody } from './lib/errors';
import { ownerMiddleware } from './lib/owner';
import { geocodeRoutes } from './routes/geocode';
import { kundaliRoutes } from './routes/kundali';
import { sessionRoutes } from './routes/sessions';
import { profiles } from './routes/profiles';
import { AskPanchangClient, type KundaliClient } from './services/askpanchang';
import type { Geocoder } from './services/geocoder';
import { DevEchoLlm, WorkersAiLlm, type LlmClient } from './services/llm';
import type { AppEnv } from './types';

export type AppDeps = {
  geocoder?: Geocoder;
  kundaliClient?: (env: Env) => KundaliClient;
  llm?: (env: Env) => LlmClient;
};

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  api.use(
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large'), 413),
    }),
  );
  api.use(ownerMiddleware);

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

  api.route('/profiles', profiles);
  api.route('/geocode', geocodeRoutes(deps.geocoder));
  api.route('/', kundaliRoutes(deps.kundaliClient ?? ((env) => new AskPanchangClient(env))));
  api.route(
    '/',
    sessionRoutes(
      deps.llm ??
        ((env) => (env.AI_MODEL === 'dev:echo' ? new DevEchoLlm() : new WorkersAiLlm(env))),
    ),
  );

  api.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));

  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(errorBody(err.code, err.message, err.details), err.status);
    }
    // Log only the error type, never request bodies (personal data).
    console.error('unhandled_error', err instanceof Error ? err.name : 'unknown');
    return c.json(errorBody('INTERNAL_ERROR', 'Something went wrong'), 500);
  });

  // Only /api/* reaches the Worker (assets.run_worker_first); everything else
  // is served by static assets with SPA fallback.
  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));

  return app;
}
