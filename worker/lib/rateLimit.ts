import { AppError } from './errors';

const HOUR_MS = 60 * 60 * 1000;

export type LimitKind = 'questions' | 'kundalis';

const QUERIES: Record<LimitKind, string> = {
  // Questions asked by this owner (sessions of deleted profiles still count).
  questions: `SELECT COUNT(*) AS n, MIN(m.created_at) AS oldest FROM qa_messages m
    JOIN qa_sessions s ON s.id = m.session_id JOIN profiles p ON p.id = s.profile_id
    WHERE p.owner_id = ? AND m.role = 'user' AND m.created_at > ?`,
  kundalis: `SELECT COUNT(*) AS n, MIN(k.created_at) AS oldest FROM kundalis k
    JOIN profiles p ON p.id = k.profile_id WHERE p.owner_id = ? AND k.created_at > ?`,
};

const MESSAGES: Record<LimitKind, (limit: number) => string> = {
  questions: (l) =>
    `You've asked ${l} questions in the last hour. Please wait a little before asking more.`,
  kundalis: (l) =>
    `You've generated ${l} kundalis in the last hour. Please wait a little before generating more.`,
};

export function limitFor(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Sliding one-hour window per owner, counted from the rows themselves, so no
 * extra storage is needed. Throws 429 RATE_LIMITED with retry-after seconds.
 */
export async function enforceHourlyLimit(
  db: D1Database,
  ownerId: string,
  kind: LimitKind,
  limit: number,
  now = Date.now(),
): Promise<void> {
  const since = new Date(now - HOUR_MS).toISOString();
  const row = await db
    .prepare(QUERIES[kind])
    .bind(ownerId, since)
    .first<{ n: number; oldest: string | null }>();
  if (!row || row.n < limit) return;
  const retryAfter = row.oldest
    ? Math.max(1, Math.ceil((new Date(row.oldest).getTime() + HOUR_MS - now) / 1000))
    : 3600;
  throw new AppError(429, 'RATE_LIMITED', MESSAGES[kind](limit), { retryAfter });
}
