import type { Message, Relation, Session } from '../../shared/session';
import { newId, nowIso } from '../lib/ids';

type SessionRow = {
  id: string;
  profile_id: string;
  kundali_id: string;
  title: string;
  model: string;
  lang: Session['lang'];
  created_at: string;
  updated_at: string;
  message_count: number;
  partner_profile_id: string | null;
  partner_kundali_id: string | null;
  partner_name: string | null;
  partner_ok: number;
  relation: string | null;
};

type MessageRow = {
  id: string;
  role: Message['role'];
  content: string;
  status: Message['status'];
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
  completed_at: string | null;
  created_at: string;
};

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  profileId: r.profile_id,
  kundaliId: r.kundali_id,
  title: r.title,
  model: r.model,
  lang: r.lang,
  messageCount: r.message_count,
  // The second person shows only while the session's owner can still read that profile.
  partner:
    r.partner_ok && r.partner_profile_id && r.partner_kundali_id && r.partner_name && r.relation
      ? {
          profileId: r.partner_profile_id,
          kundaliId: r.partner_kundali_id,
          name: r.partner_name,
          relation: r.relation as Relation,
        }
      : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  role: r.role,
  content: r.content,
  // Abandoned answers show as failed instead of spinning forever.
  status:
    r.status === 'streaming' && Date.now() - Date.parse(r.created_at) > STALE_ANSWER_MS
      ? 'error'
      : r.status,
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  model: r.role === 'assistant' ? r.model : null,
  durationMs:
    r.role === 'assistant' && r.completed_at
      ? Math.max(0, Date.parse(r.completed_at) - Date.parse(r.created_at))
      : null,
  createdAt: r.created_at,
});

const SESSION_SELECT = `SELECT s.id, s.profile_id, s.kundali_id, s.title, s.model, s.lang, s.created_at, s.updated_at,
  (SELECT COUNT(*) FROM qa_messages m WHERE m.session_id = s.id) AS message_count,
  s.partner_profile_id, s.partner_kundali_id, s.relation, pp.name AS partner_name,
  CASE WHEN pp.id IS NOT NULL AND pp.deleted_at IS NULL AND (pp.owner_id = s.owner_id OR EXISTS (
    SELECT 1 FROM profile_shares sh2 WHERE sh2.profile_id = pp.id AND sh2.email = s.owner_id))
  THEN 1 ELSE 0 END AS partner_ok
  FROM qa_sessions s JOIN profiles p ON p.id = s.profile_id
  LEFT JOIN profiles pp ON pp.id = s.partner_profile_id`;

/**
 * A session is visible only to its creator, and only while they can still
 * read the profile (they own it, or it is still shared with them). Bind the
 * user id once.
 */
const VISIBLE = `s.deleted_at IS NULL AND p.deleted_at IS NULL AND s.owner_id = ?
  AND (p.owner_id = s.owner_id OR EXISTS (
    SELECT 1 FROM profile_shares sh WHERE sh.profile_id = p.id AND sh.email = s.owner_id))`;

export async function listSessions(db: D1Database, ownerId: string, profileId: string) {
  const { results } = await db
    .prepare(
      `${SESSION_SELECT} WHERE ${VISIBLE} AND s.profile_id = ?
       ORDER BY s.updated_at DESC, s.id DESC LIMIT 200`,
    )
    .bind(ownerId, profileId)
    .all<SessionRow>();
  return results.map(toSession);
}

export async function getSession(db: D1Database, ownerId: string, id: string) {
  const row = await db
    .prepare(`${SESSION_SELECT} WHERE ${VISIBLE} AND s.id = ?`)
    .bind(ownerId, id)
    .first<SessionRow>();
  return row ? toSession(row) : null;
}

export async function insertSession(
  db: D1Database,
  v: {
    ownerId: string;
    profileId: string;
    kundaliId: string;
    title: string;
    model: string;
    lang: string;
  },
): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO qa_sessions (id, owner_id, profile_id, kundali_id, title, model, lang, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, v.ownerId, v.profileId, v.kundaliId, v.title, v.model, v.lang, now, now)
    .run();
  return id;
}

/** Set or clear the session's second person. */
export async function setPartner(
  db: D1Database,
  id: string,
  p: { profileId: string; kundaliId: string; relation: Relation } | null,
) {
  await db
    .prepare(
      'UPDATE qa_sessions SET partner_profile_id = ?, partner_kundali_id = ?, relation = ?, updated_at = ? WHERE id = ?',
    )
    .bind(p?.profileId ?? null, p?.kundaliId ?? null, p?.relation ?? null, nowIso(), id)
    .run();
}

export async function updateSession(
  db: D1Database,
  id: string,
  v: { title?: string; lang?: string; model?: string },
) {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (v.title !== undefined) {
    sets.push('title = ?');
    binds.push(v.title);
  }
  if (v.lang !== undefined) {
    sets.push('lang = ?');
    binds.push(v.lang);
  }
  if (v.model !== undefined) {
    sets.push('model = ?');
    binds.push(v.model);
  }
  sets.push('updated_at = ?');
  binds.push(nowIso());
  await db
    .prepare(`UPDATE qa_sessions SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
}

export async function softDeleteSession(db: D1Database, id: string) {
  await db.prepare('UPDATE qa_sessions SET deleted_at = ? WHERE id = ?').bind(nowIso(), id).run();
}

export async function listMessages(db: D1Database, sessionId: string): Promise<Message[]> {
  const { results } = await db
    .prepare(
      `SELECT id, role, content, status, tokens_in, tokens_out, model, completed_at, created_at FROM qa_messages
       WHERE session_id = ? ORDER BY created_at, rowid`,
    )
    .bind(sessionId)
    .all<MessageRow>();
  return results.map(toMessage);
}

/** True if an answer is being written in this session (ignoring rows stuck for > 5 min). */
/** An answer still "streaming" after this long was abandoned (the Worker was stopped). */
export const STALE_ANSWER_MS = 5 * 60_000;

export async function hasActiveAnswer(db: D1Database, sessionId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_ANSWER_MS).toISOString();
  const row = await db
    .prepare(
      `SELECT 1 FROM qa_messages WHERE session_id = ? AND status = 'streaming' AND created_at > ? LIMIT 1`,
    )
    .bind(sessionId, cutoff)
    .first();
  return Boolean(row);
}

/** Insert the question and an empty streaming answer in one batch. */
export async function insertQuestionAndPlaceholder(
  db: D1Database,
  sessionId: string,
  question: string,
  promptVersion: string,
  model: string,
) {
  const userId = newId();
  const assistantId = newId();
  const t = Date.now();
  const at = (ms: number) => new Date(ms).toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO qa_messages (id, session_id, role, content, status, created_at)
         VALUES (?, ?, 'user', ?, 'complete', ?)`,
      )
      .bind(userId, sessionId, question, at(t)),
    db
      .prepare(
        `INSERT INTO qa_messages (id, session_id, role, content, status, prompt_version, model, created_at)
         VALUES (?, ?, 'assistant', '', 'streaming', ?, ?, ?)`,
      )
      .bind(assistantId, sessionId, promptVersion, model, at(t + 1)),
  ]);
  return { userId, assistantId };
}

export async function finishAnswer(
  db: D1Database,
  id: string,
  v: {
    content: string;
    status: 'complete' | 'error';
    tokensIn: number | null;
    tokensOut: number | null;
  },
) {
  await db
    .prepare(
      'UPDATE qa_messages SET content = ?, status = ?, tokens_in = ?, tokens_out = ?, completed_at = ? WHERE id = ?',
    )
    .bind(v.content, v.status, v.tokensIn, v.tokensOut, nowIso(), id)
    .run();
}

/**
 * Save the partial answer (so a reopened chat shows progress) and report
 * whether the user pressed Stop.
 */
export async function saveProgress(db: D1Database, id: string, content: string) {
  const row = await db
    .prepare(
      `UPDATE qa_messages SET content = ? WHERE id = ? AND status = 'streaming' RETURNING stop_requested`,
    )
    .bind(content, id)
    .first<{ stop_requested: number }>();
  return { stopRequested: row?.stop_requested === 1 };
}

/** Ask the session's running answer to stop. Returns whether one was running. */
export async function requestStop(db: D1Database, sessionId: string) {
  const r = await db
    .prepare(
      `UPDATE qa_messages SET stop_requested = 1 WHERE session_id = ? AND status = 'streaming'`,
    )
    .bind(sessionId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function getKundaliForSession(db: D1Database, kundaliId: string) {
  return db
    .prepare(
      'SELECT id, profile_id, request_json, response_json, time_uncertain, lang, input_hash FROM kundalis WHERE id = ?',
    )
    .bind(kundaliId)
    .first<{
      id: string;
      profile_id: string;
      request_json: string;
      response_json: string;
      time_uncertain: number;
      lang: string;
      input_hash: string;
    }>();
}

export async function latestKundaliId(db: D1Database, profileId: string) {
  const row = await db
    .prepare(
      'SELECT id, lang FROM kundalis WHERE profile_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    )
    .bind(profileId)
    .first<{ id: string; lang: string }>();
  return row;
}
