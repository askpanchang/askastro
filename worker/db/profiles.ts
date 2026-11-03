import type {
  KundaliSummary,
  Profile,
  ProfileAccess,
  ProfileListItem,
  ProfileValues,
  Share,
} from '../../shared/profile';
import { chartInputHash } from '../lib/hash';
import type { Cursor } from '../lib/cursor';
import { newId, nowIso } from '../lib/ids';

type ProfileRow = {
  id: string;
  name: string;
  gender: 'm' | 'f' | 'o';
  dob: string;
  tob: string | null;
  tob_unknown: number;
  place: string;
  lat: number;
  lon: number;
  tz: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type KundaliMetaRow = {
  id: string;
  ayanamsa: string;
  chart_style: string;
  lang: string;
  input_hash: string;
  created_at: string;
};

const PROFILE_COLS =
  'id, name, gender, dob, tob, tob_unknown, place, lat, lon, tz, notes, created_at, updated_at';

export function toProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    gender: r.gender,
    dob: r.dob,
    tob: r.tob,
    tobUnknown: r.tob_unknown === 1,
    place: r.place,
    lat: r.lat,
    lon: r.lon,
    tz: r.tz,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function isStale(p: Profile, k: KundaliMetaRow): Promise<boolean> {
  const hash = await chartInputHash(p, {
    ayanamsa: k.ayanamsa,
    chartStyle: k.chart_style,
    lang: k.lang,
  });
  return hash !== k.input_hash;
}

export async function getProfile(db: D1Database, ownerId: string, id: string) {
  const row = await db
    .prepare(
      `SELECT ${PROFILE_COLS} FROM profiles WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    )
    .bind(id, ownerId)
    .first<ProfileRow>();
  return row ? toProfile(row) : null;
}

/** SQL: the current user (bound twice) owns the profile or it is shared with them. */
export const CAN_READ_PROFILE = `(p.owner_id = ? OR EXISTS (
  SELECT 1 FROM profile_shares sh WHERE sh.profile_id = p.id AND sh.email = ?))`;

export type AccessibleProfile = { profile: Profile; access: ProfileAccess; ownerId: string };

/** A profile the user owns or that is shared with them. */
export async function getAccessibleProfile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<AccessibleProfile | null> {
  const cols = PROFILE_COLS.split(', ')
    .map((c) => `p.${c}`)
    .join(', ');
  const row = await db
    .prepare(
      `SELECT ${cols}, p.owner_id FROM profiles p
       WHERE p.id = ? AND p.deleted_at IS NULL AND ${CAN_READ_PROFILE}`,
    )
    .bind(id, userId, userId)
    .first<ProfileRow & { owner_id: string }>();
  if (!row) return null;
  return {
    profile: toProfile(row),
    access: row.owner_id === userId ? 'owner' : 'shared',
    ownerId: row.owner_id,
  };
}

export async function listShares(db: D1Database, profileId: string): Promise<Share[]> {
  const { results } = await db
    .prepare(
      'SELECT email, created_at FROM profile_shares WHERE profile_id = ? ORDER BY created_at, email',
    )
    .bind(profileId)
    .all<{ email: string; created_at: string }>();
  return results.map((r) => ({ email: r.email, createdAt: r.created_at }));
}

/** Returns false if it was already shared with this email. */
export async function addShare(
  db: D1Database,
  v: { profileId: string; email: string; createdBy: string },
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO profile_shares (profile_id, email, created_by, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id, email) DO NOTHING`,
    )
    .bind(v.profileId, v.email, v.createdBy, nowIso())
    .run();
  return res.meta.changes > 0;
}

export async function removeShare(db: D1Database, profileId: string, email: string) {
  const res = await db
    .prepare('DELETE FROM profile_shares WHERE profile_id = ? AND email = ?')
    .bind(profileId, email)
    .run();
  return res.meta.changes > 0;
}

export async function getLatestKundaliSummary(
  db: D1Database,
  profile: Profile,
): Promise<KundaliSummary | null> {
  const k = await db
    .prepare(
      `SELECT id, ayanamsa, chart_style, lang, input_hash, created_at FROM kundalis
       WHERE profile_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(profile.id)
    .first<KundaliMetaRow>();
  if (!k) return null;
  return {
    id: k.id,
    ayanamsa: k.ayanamsa,
    chartStyle: k.chart_style,
    lang: k.lang,
    createdAt: k.created_at,
    stale: await isStale(profile, k),
  };
}

export async function listProfiles(
  db: D1Database,
  ownerId: string,
  opts: { q?: string; cursor: Cursor | null; limit: number },
): Promise<{ items: ProfileListItem[]; next: Cursor | null }> {
  const where = [CAN_READ_PROFILE, 'p.deleted_at IS NULL'];
  const binds: unknown[] = [ownerId, ownerId];
  if (opts.q) {
    where.push(`p.name LIKE ? ESCAPE '\\'`);
    binds.push(`%${opts.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  if (opts.cursor) {
    where.push('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))');
    binds.push(opts.cursor.createdAt, opts.cursor.createdAt, opts.cursor.id);
  }
  const cols = PROFILE_COLS.split(', ')
    .map((c) => `p.${c}`)
    .join(', ');
  const { results } = await db
    .prepare(
      `SELECT ${cols}, p.owner_id,
         k.id AS k_id, k.ayanamsa AS k_ayanamsa, k.chart_style AS k_chart_style,
         k.lang AS k_lang, k.input_hash AS k_input_hash, k.created_at AS k_created_at,
         (SELECT MAX(s.updated_at) FROM qa_sessions s
            WHERE s.profile_id = p.id AND s.owner_id = ? AND s.deleted_at IS NULL) AS last_session_at
       FROM profiles p
       LEFT JOIN kundalis k ON k.id = (
         SELECT id FROM kundalis WHERE profile_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1
       )
       WHERE ${where.join(' AND ')}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ?`,
    )
    .bind(ownerId, ...binds, opts.limit + 1)
    .all<
      ProfileRow & {
        owner_id: string;
        k_id: string | null;
        k_ayanamsa: string;
        k_chart_style: string;
        k_lang: string;
        k_input_hash: string;
        k_created_at: string;
        last_session_at: string | null;
      }
    >();

  const page = results.slice(0, opts.limit);
  const items = await Promise.all(
    page.map(async (r): Promise<ProfileListItem> => {
      const profile = toProfile(r);
      let kundaliStatus: ProfileListItem['kundaliStatus'] = 'none';
      if (r.k_id) {
        const stale = await isStale(profile, {
          id: r.k_id,
          ayanamsa: r.k_ayanamsa,
          chart_style: r.k_chart_style,
          lang: r.k_lang,
          input_hash: r.k_input_hash,
          created_at: r.k_created_at,
        });
        kundaliStatus = stale ? 'stale' : 'current';
      }
      const shared = r.owner_id !== ownerId;
      return {
        ...profile,
        kundaliStatus,
        lastSessionAt: r.last_session_at,
        access: shared ? 'shared' : 'owner',
        sharedBy: shared ? r.owner_id : null,
      };
    }),
  );
  const last = page.at(-1);
  const next =
    results.length > opts.limit && last ? { createdAt: last.created_at, id: last.id } : null;
  return { items, next };
}

export async function insertProfile(
  db: D1Database,
  ownerId: string,
  v: ProfileValues,
): Promise<Profile> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO profiles (id, owner_id, name, gender, dob, tob, tob_unknown, place, lat, lon, tz, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      ownerId,
      v.name,
      v.gender,
      v.dob,
      v.tob,
      v.tobUnknown ? 1 : 0,
      v.place,
      v.lat,
      v.lon,
      v.tz,
      v.notes,
      now,
      now,
    )
    .run();
  return { id, ...v, createdAt: now, updatedAt: now };
}

export async function updateProfile(
  db: D1Database,
  ownerId: string,
  id: string,
  v: ProfileValues,
): Promise<string | null> {
  const now = nowIso();
  const res = await db
    .prepare(
      `UPDATE profiles SET name = ?, gender = ?, dob = ?, tob = ?, tob_unknown = ?, place = ?,
         lat = ?, lon = ?, tz = ?, notes = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    )
    .bind(
      v.name,
      v.gender,
      v.dob,
      v.tob,
      v.tobUnknown ? 1 : 0,
      v.place,
      v.lat,
      v.lon,
      v.tz,
      v.notes,
      now,
      id,
      ownerId,
    )
    .run();
  return res.meta.changes ? now : null;
}

export async function softDeleteProfile(db: D1Database, ownerId: string, id: string) {
  const res = await db
    .prepare(
      'UPDATE profiles SET deleted_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
    )
    .bind(nowIso(), id, ownerId)
    .run();
  return res.meta.changes > 0;
}
