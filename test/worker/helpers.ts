import { exports } from 'cloudflare:workers';

export const ARJUN = {
  name: 'Arjun Sharma',
  gender: 'm',
  dob: '1990-08-15',
  tob: '14:30',
  tobUnknown: false,
  place: 'Hyderabad, Telangana, India',
  lat: 17.385,
  lon: 78.4867,
  tz: 'Asia/Kolkata',
} as const;

/** Call the Worker as a given owner (Cloudflare Access header). */
export function api(path: string, init: RequestInit & { owner?: string; json?: unknown } = {}) {
  const { owner, json, headers, ...rest } = init;
  const h = new Headers(headers);
  if (owner) h.set('cf-access-authenticated-user-email', owner);
  if (json !== undefined) h.set('content-type', 'application/json');
  return exports.default.fetch(`https://studio.test${path}`, {
    ...rest,
    headers: h,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

let n = 0;
/** A fresh owner per test keeps tests independent of shared storage. */
export const freshOwner = () => `user${++n}-${crypto.randomUUID().slice(0, 8)}@test.dev`;
