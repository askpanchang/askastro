import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const DEFAULT_OWNER = 'default';

/**
 * Resolves the owner for this request. Cloudflare Access sets
 * Cf-Access-Authenticated-User-Email on authenticated requests; without it
 * (local dev) everything belongs to 'default'.
 *
 * TODO(Phase 4): verify the Cf-Access-Jwt-Assertion JWT when ACCESS_AUD is set,
 * so the header can't be spoofed if the Worker is reachable without Access.
 */
export const ownerMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const email = c.req.header('cf-access-authenticated-user-email')?.trim().toLowerCase();
  c.set('ownerId', email || DEFAULT_OWNER);
  await next();
};
