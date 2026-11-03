import { Hono } from 'hono';
import {
  ProfileInputSchema,
  ProfileListQuerySchema,
  ProfilePatchSchema,
  type Profile,
  type ProfileDetail,
  type ProfileList,
} from '../../shared/profile';
import {
  getLatestKundaliSummary,
  getProfile,
  insertProfile,
  listProfiles,
  softDeleteProfile,
  updateProfile,
} from '../db/profiles';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { AppError } from '../lib/errors';
import { isId } from '../lib/ids';
import { parseJson, parseQuery, parseValue } from '../lib/validate';
import type { AppEnv } from '../types';

const notFound = () => new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found');

export async function requireProfile(db: D1Database, ownerId: string, id: string) {
  if (!isId(id)) throw notFound();
  const profile = await getProfile(db, ownerId, id);
  if (!profile) throw notFound();
  return profile;
}

export const profiles = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { q, cursor, limit } = parseQuery(c, ProfileListQuerySchema);
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) throw new AppError(400, 'INVALID_CURSOR', 'Invalid cursor');
    const { items, next } = await listProfiles(c.env.DB, c.get('ownerId'), {
      q: q || undefined,
      cursor: decoded,
      limit,
    });
    const body: ProfileList = { items, nextCursor: next ? encodeCursor(next) : null };
    return c.json(body);
  })
  .post('/', async (c) => {
    const values = await parseJson(c, ProfileInputSchema);
    const profile = await insertProfile(c.env.DB, c.get('ownerId'), values);
    return c.json({ profile }, 201);
  })
  .get('/:id', async (c) => {
    const profile = await requireProfile(c.env.DB, c.get('ownerId'), c.req.param('id'));
    const body: ProfileDetail = {
      profile,
      latestKundali: await getLatestKundaliSummary(c.env.DB, profile),
    };
    return c.json(body);
  })
  .patch('/:id', async (c) => {
    const ownerId = c.get('ownerId');
    const existing = await requireProfile(c.env.DB, ownerId, c.req.param('id'));
    const patch = await parseJson(c, ProfilePatchSchema);
    // Re-validate the whole merged row so cross-field rules (time vs. "unknown") hold.
    const merged = parseValue(ProfileInputSchema, { ...existing, ...patch });
    const updatedAt = await updateProfile(c.env.DB, ownerId, existing.id, merged);
    if (!updatedAt) throw notFound();
    const profile: Profile = { ...existing, ...merged, updatedAt };
    return c.json({ profile });
  })
  .delete('/:id', async (c) => {
    const ownerId = c.get('ownerId');
    const existing = await requireProfile(c.env.DB, ownerId, c.req.param('id'));
    await softDeleteProfile(c.env.DB, ownerId, existing.id);
    return c.json({ ok: true as const });
  });
