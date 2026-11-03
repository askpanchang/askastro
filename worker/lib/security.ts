import type { MiddlewareHandler } from 'hono';
import { errorBody } from './errors';
import type { AppEnv } from '../types';

/**
 * Headers for every API response. Static assets (the SPA shell) get theirs
 * from public/_headers, which Workers does not apply to Worker responses.
 */
export const apiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('x-frame-options', 'DENY');
  h.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  // Personal data: don't let browsers or proxies cache API responses by default.
  if (!h.has('cache-control')) h.set('cache-control', 'no-store');
  const retryAfter = (await peekRetryAfter(c.res)) ?? null;
  if (retryAfter !== null) h.set('retry-after', String(retryAfter));
};

async function peekRetryAfter(res: Response): Promise<number | null> {
  if (res.status !== 429) return null;
  try {
    const body = (await res.clone().json()) as { error?: { details?: { retryAfter?: number } } };
    return body.error?.details?.retryAfter ?? null;
  } catch {
    return null;
  }
}

/**
 * Same-origin only. Browsers send Origin on cross-site POST/PATCH/DELETE (and
 * Sec-Fetch-Site), so a page on another site can't make the user's browser
 * change data here even with their Access cookie.
 */
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    return next();
  }
  const site = c.req.header('sec-fetch-site');
  const origin = c.req.header('origin');
  const crossSite = site === 'cross-site' || site === 'same-site';
  let otherOrigin = false;
  if (origin && origin !== 'null') {
    try {
      otherOrigin = new URL(origin).host !== new URL(c.req.url).host;
    } catch {
      otherOrigin = true;
    }
  } else if (origin === 'null') {
    otherOrigin = true;
  }
  if (crossSite || otherOrigin) {
    return c.json(errorBody('CROSS_ORIGIN', 'Cross-site requests are not allowed'), 403);
  }
  return next();
};
