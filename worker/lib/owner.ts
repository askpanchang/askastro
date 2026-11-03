import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { AppError } from './errors';
import type { AppEnv } from '../types';

export const DEFAULT_OWNER = 'default';

const jwksCache = new Map<string, JWTVerifyGetKey>();
function jwksFor(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

/** Tests can replace the key source. */
export const accessKeys = { get: jwksFor };

function readToken(header: string | undefined, cookie: string | undefined): string | null {
  if (header) return header;
  const m = cookie?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m?.[1] ?? null;
}

/**
 * Resolves the owner for this request.
 *
 * - ACCESS_AUD set (production): a valid Cloudflare Access JWT is required.
 *   It is verified against the team's signing keys (issuer = ACCESS_TEAM_DOMAIN,
 *   audience = ACCESS_AUD) and the owner is the token's email.
 * - ACCESS_AUD unset (local dev and tests): the Cf-Access-Authenticated-User-Email
 *   header is used if present, otherwise everything belongs to 'default'.
 */
export const ownerMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const aud = c.env.ACCESS_AUD?.trim();
  if (!aud) {
    const email = c.req.header('cf-access-authenticated-user-email')?.trim().toLowerCase();
    c.set('ownerId', email || DEFAULT_OWNER);
    return next();
  }

  const team = c.env.ACCESS_TEAM_DOMAIN?.trim().replace(/\/+$/, '');
  if (!team) {
    console.error('auth_misconfigured', 'ACCESS_TEAM_DOMAIN missing');
    throw new AppError(500, 'AUTH_MISCONFIGURED', 'Sign-in is not configured correctly.');
  }
  const token = readToken(c.req.header('cf-access-jwt-assertion'), c.req.header('cookie'));
  if (!token) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign-in required. Reload the page to sign in.');
  }
  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, accessKeys.get(team), {
      issuer: team,
      audience: aud,
      algorithms: ['RS256'],
    });
    email = payload.email;
  } catch {
    throw new AppError(
      401,
      'UNAUTHENTICATED',
      'Your sign-in has expired or is invalid. Reload the page to sign in again.',
    );
  }
  if (typeof email !== 'string' || !email.includes('@')) {
    // e.g. an Access service token: no user identity to own data.
    throw new AppError(403, 'FORBIDDEN', 'A signed-in user is required.');
  }
  c.set('ownerId', email.trim().toLowerCase());
  return next();
};
