import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Health } from '../shared/api';
import type { Me } from '../shared/profile';
import { AppError, errorBody } from './lib/errors';
import { ownerMiddleware } from './lib/owner';
import { apiHeaders, sameOriginOnly } from './lib/security';
import { geocodeRoutes } from './routes/geocode';
import { kundaliRoutes } from './routes/kundali';
import { sessionRoutes } from './routes/sessions';
import { profiles } from './routes/profiles';
import { settings } from './routes/settings';
import { buildUsage } from './services/aiUsage';
import { AskPanchangClient, type KundaliClient } from './services/askpanchang';
import type { Geocoder } from './services/geocoder';
import { DevEchoLlm, WorkersAiLlm, type LlmClient } from './services/llm';
import type { AppEnv } from './types';

export type AppDeps = {
  geocoder?: Geocoder;
  kundaliClient?: (env: Env) => KundaliClient;
  /** Builds the client for the model picked for this answer (see services/modelChoice). */
  llm?: (env: Env, model: string) => LlmClient;
};

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  app.use('/api/*', apiHeaders);

  // Liveness: public (no auth) and reveals nothing beyond up/down.
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

  api.use(sameOriginOnly);
  api.use(
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large'), 413),
    }),
  );
  api.use(ownerMiddleware);

  api.get('/me', (c) => {
    const body: Me = { email: c.get('ownerId'), isAdmin: c.get('isAdmin') };
    return c.json(body);
  });
  api.get('/usage', async (c) =>
    c.json(await buildUsage(c.env, c.get('ownerId'), c.get('isAdmin'))),
  );
  api.route('/profiles', profiles);
  api.route('/settings', settings);
  api.route('/geocode', geocodeRoutes(deps.geocoder));
  api.route('/', kundaliRoutes(deps.kundaliClient ?? ((env) => new AskPanchangClient(env))));
  api.route(
    '/',
    sessionRoutes(
      deps.llm ??
        ((env, model) => (model === 'dev:echo' ? new DevEchoLlm() : new WorkersAiLlm(env, model))),
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
