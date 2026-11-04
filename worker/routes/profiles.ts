import { Hono } from 'hono';
import {
  MAX_SHARES_PER_PROFILE,
  ProfileInputSchema,
  ProfileListQuerySchema,
  ProfilePatchSchema,
  ShareCreateSchema,
  type Profile,
  type ProfileDetail,
  type ProfileList,
} from '../../shared/profile';
import {
  addShare,
  getAccessibleProfile,
  getLatestKundaliSummary,
  insertProfile,
  listProfiles,
  listShares,
  removeShare,
  softDeleteProfile,
  updateProfile,
  type AccessibleProfile,
} from '../db/profiles';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { AppError } from '../lib/errors';
import { isId } from '../lib/ids';
import { parseJson, parseQuery, parseValue } from '../lib/validate';
import type { AppEnv } from '../types';

const notFound = () => new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found');

/** Profile the user owns or that is shared with them (view + Q&A). */
export async function requireReadableProfile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<AccessibleProfile> {
  if (!isId(id)) throw notFound();
  const found = await getAccessibleProfile(db, userId, id);
  if (!found) throw notFound();
  return found;
}

/** Profile the user owns: needed to edit, delete, regenerate or share it. */
export async function requireOwnedProfile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<Profile> {
  const found = await requireReadableProfile(db, userId, id);
  if (found.access !== 'owner') {
    throw new AppError(403, 'NOT_PROFILE_OWNER', "Only the profile's owner can do this.");
  }
  return found.profile;
}

/** Back-compat helper for read access. */
export async function requireProfile(db: D1Database, userId: string, id: string) {
  return (await requireReadableProfile(db, userId, id)).profile;
}

export function requireAdmin(
  isAdmin: boolean,
  message = 'Only the app owner can create profiles.',
) {
  if (!isAdmin) {
    throw new AppError(403, 'ADMIN_ONLY', message);
  }
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
    requireAdmin(c.get('isAdmin'));
    const values = await parseJson(c, ProfileInputSchema);
    const profile = await insertProfile(c.env.DB, c.get('ownerId'), values);
    return c.json({ profile }, 201);
  })
  .get('/:id', async (c) => {
    const { profile, access, ownerId } = await requireReadableProfile(
      c.env.DB,
      c.get('ownerId'),
      c.req.param('id'),
    );
    const body: ProfileDetail = {
      profile,
      latestKundali: await getLatestKundaliSummary(c.env.DB, profile),
      access,
      sharedBy: access === 'shared' ? ownerId : null,
    };
    return c.json(body);
  })
  .patch('/:id', async (c) => {
    const ownerId = c.get('ownerId');
    const existing = await requireOwnedProfile(c.env.DB, ownerId, c.req.param('id'));
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
    const existing = await requireOwnedProfile(c.env.DB, ownerId, c.req.param('id'));
    await softDeleteProfile(c.env.DB, ownerId, existing.id);
    return c.json({ ok: true as const });
  })
  .get('/:id/shares', async (c) => {
    const profile = await requireOwnedProfile(c.env.DB, c.get('ownerId'), c.req.param('id'));
    return c.json({ items: await listShares(c.env.DB, profile.id) });
  })
  .post('/:id/shares', async (c) => {
    const ownerId = c.get('ownerId');
    const profile = await requireOwnedProfile(c.env.DB, ownerId, c.req.param('id'));
    const { email } = await parseJson(c, ShareCreateSchema);
    if (email === ownerId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'You already own this profile', {
        formErrors: [],
        fieldErrors: { email: ['You already own this profile'] },
      });
    }
    const existing = await listShares(c.env.DB, profile.id);
    if (existing.length >= MAX_SHARES_PER_PROFILE && !existing.some((s) => s.email === email)) {
      throw new AppError(
        400,
        'TOO_MANY_SHARES',
        `A profile can be shared with at most ${MAX_SHARES_PER_PROFILE} people.`,
      );
    }
    const created = await addShare(c.env.DB, { profileId: profile.id, email, createdBy: ownerId });
    return c.json({ items: await listShares(c.env.DB, profile.id) }, created ? 201 : 200);
  })
  .delete('/:id/shares/:email', async (c) => {
    const profile = await requireOwnedProfile(c.env.DB, c.get('ownerId'), c.req.param('id'));
    const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
    await removeShare(c.env.DB, profile.id, email);
    return c.json({ items: await listShares(c.env.DB, profile.id) });
  });
