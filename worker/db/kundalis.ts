import {
  AskPanchangKundaliSchema,
  type KundaliDetail,
  type KundaliOptions,
  type KundaliVersion,
} from '../../shared/kundali';
import type { Profile } from '../../shared/profile';
import { chartInputHash } from '../lib/hash';
import { AppError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';

type KundaliRow = {
  id: string;
  profile_id: string;
  ayanamsa: string;
  chart_style: 'north' | 'south';
  lang: string;
  input_hash: string;
  time_uncertain: number;
  created_at: string;
};

const META_COLS =
  'k.id, k.profile_id, k.ayanamsa, k.chart_style, k.lang, k.input_hash, k.time_uncertain, k.created_at';

async function toVersion(r: KundaliRow, profile: Profile): Promise<KundaliVersion> {
  const hash = await chartInputHash(profile, {
    ayanamsa: r.ayanamsa,
    chartStyle: r.chart_style,
    lang: r.lang,
  });
  return {
    id: r.id,
    profileId: r.profile_id,
    ayanamsa: r.ayanamsa,
    chartStyle: r.chart_style,
    lang: r.lang,
    timeUncertain: r.time_uncertain === 1,
    stale: hash !== r.input_hash,
    createdAt: r.created_at,
  };
}

export async function insertKundali(
  db: D1Database,
  v: {
    profile: Profile;
    options: KundaliOptions;
    requestJson: string;
    responseJson: string;
    digest: string;
    timeUncertain: boolean;
  },
): Promise<{ id: string; createdAt: string; inputHash: string }> {
  const id = newId();
  const createdAt = nowIso();
  const inputHash = await chartInputHash(v.profile, v.options);
  await db
    .prepare(
      `INSERT INTO kundalis (id, profile_id, ayanamsa, chart_style, lang, request_json, response_json, digest, input_hash, time_uncertain, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      v.profile.id,
      v.options.ayanamsa,
      v.options.chartStyle,
      v.options.lang,
      v.requestJson,
      v.responseJson,
      v.digest,
      inputHash,
      v.timeUncertain ? 1 : 0,
      createdAt,
    )
    .run();
  return { id, createdAt, inputHash };
}

export async function listKundaliVersions(
  db: D1Database,
  profile: Profile,
): Promise<KundaliVersion[]> {
  const { results } = await db
    .prepare(
      `SELECT ${META_COLS} FROM kundalis k WHERE k.profile_id = ?
       ORDER BY k.created_at DESC, k.id DESC LIMIT 100`,
    )
    .bind(profile.id)
    .all<KundaliRow>();
  return Promise.all(results.map((r) => toVersion(r, profile)));
}

/** Full kundali, scoped to the owner through its (non-deleted) profile. */
export async function getKundaliDetail(
  db: D1Database,
  id: string,
  getProfile: (profileId: string) => Promise<Profile | null>,
): Promise<KundaliDetail | null> {
  const row = await db
    .prepare(`SELECT ${META_COLS}, k.response_json, k.digest FROM kundalis k WHERE k.id = ?`)
    .bind(id)
    .first<KundaliRow & { response_json: string; digest: string }>();
  if (!row) return null;
  const profile = await getProfile(row.profile_id);
  if (!profile) return null;
  const parsed = AskPanchangKundaliSchema.safeParse(JSON.parse(row.response_json));
  if (!parsed.success) {
    throw new AppError(500, 'KUNDALI_CORRUPT', 'This kundali could not be read. Regenerate it.');
  }
  return { ...(await toVersion(row, profile)), data: parsed.data, digest: row.digest };
}
