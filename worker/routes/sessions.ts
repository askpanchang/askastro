import { Hono } from 'hono';
import { AskPanchangKundaliSchema } from '../../shared/kundali';
import {
  AskSchema,
  DEFAULT_SESSION_TITLE,
  SessionCreateSchema,
  SessionPatchSchema,
  titleFromQuestion,
  type SessionDetail,
} from '../../shared/session';
import { sseEvent } from '../../shared/sse';
import { getLatestKundaliSummary } from '../db/profiles';
import {
  finishAnswer,
  getKundaliForSession,
  getSession,
  hasActiveAnswer,
  insertQuestionAndPlaceholder,
  insertSession,
  latestKundaliId,
  listMessages,
  listSessions,
  softDeleteSession,
  updateSession,
} from '../db/sessions';
import { AppError } from '../lib/errors';
import { isId } from '../lib/ids';
import { enforceHourlyLimit, limitFor } from '../lib/rateLimit';
import { parseJson, parseValue } from '../lib/validate';
import { buildChartDigest } from '../services/chartDigest';
import type { LlmClient } from '../services/llm';
import { PROMPT_VERSION, buildPrompt, estimateTokens } from '../services/prompts';
import type { KundaliRequest } from '../services/askpanchang';
import type { AppEnv } from '../types';
import { requireProfile } from './profiles';

const notFound = () => new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
export const STOPPED_NOTE = '\n\n_(Answer stopped before it finished.)_';

async function requireSession(db: D1Database, ownerId: string, id: string) {
  if (!isId(id)) throw notFound();
  const s = await getSession(db, ownerId, id);
  if (!s) throw notFound();
  return s;
}

async function readOptionalJson(req: { text(): Promise<string> }): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

export function sessionRoutes(llmFor: (env: Env) => LlmClient) {
  return new Hono<AppEnv>()
    .get('/profiles/:id/sessions', async (c) => {
      const ownerId = c.get('ownerId');
      const profile = await requireProfile(c.env.DB, ownerId, c.req.param('id'));
      return c.json({ items: await listSessions(c.env.DB, ownerId, profile.id) });
    })
    .post('/profiles/:id/sessions', async (c) => {
      const ownerId = c.get('ownerId');
      const profile = await requireProfile(c.env.DB, ownerId, c.req.param('id'));
      const body = parseValue(SessionCreateSchema, await readOptionalJson(c.req));
      const latest = await latestKundaliId(c.env.DB, profile.id);
      if (!latest) {
        throw new AppError(409, 'NO_KUNDALI', 'Generate a kundali before starting a Q&A session.');
      }
      const id = await insertSession(c.env.DB, {
        profileId: profile.id,
        kundaliId: latest.id,
        title: DEFAULT_SESSION_TITLE,
        model: c.env.AI_MODEL,
        lang: body.lang ?? latest.lang,
      });
      const session = await getSession(c.env.DB, ownerId, id);
      return c.json({ session }, 201);
    })
    .get('/sessions/:id', async (c) => {
      const ownerId = c.get('ownerId');
      const session = await requireSession(c.env.DB, ownerId, c.req.param('id'));
      const profile = await requireProfile(c.env.DB, ownerId, session.profileId);
      const latest = await getLatestKundaliSummary(c.env.DB, profile);
      const body: SessionDetail = {
        session,
        messages: await listMessages(c.env.DB, session.id),
        kundaliOutdated: !latest || latest.id !== session.kundaliId || latest.stale,
      };
      return c.json(body);
    })
    .patch('/sessions/:id', async (c) => {
      const ownerId = c.get('ownerId');
      const session = await requireSession(c.env.DB, ownerId, c.req.param('id'));
      const patch = await parseJson(c, SessionPatchSchema);
      await updateSession(c.env.DB, session.id, patch);
      return c.json({ session: await getSession(c.env.DB, ownerId, session.id) });
    })
    .delete('/sessions/:id', async (c) => {
      const session = await requireSession(c.env.DB, c.get('ownerId'), c.req.param('id'));
      await softDeleteSession(c.env.DB, session.id);
      return c.json({ ok: true as const });
    })
    .post('/sessions/:id/messages', async (c) => {
      const db = c.env.DB;
      const session = await requireSession(db, c.get('ownerId'), c.req.param('id'));
      const { question } = await parseJson(c, AskSchema);
      await enforceHourlyLimit(
        db,
        c.get('ownerId'),
        'questions',
        limitFor(c.env.RATE_LIMIT_QUESTIONS_PER_HOUR, 30),
      );
      if (await hasActiveAnswer(db, session.id)) {
        throw new AppError(409, 'ANSWER_IN_PROGRESS', 'Wait for the current answer to finish.');
      }

      // Context comes from the kundali this session is pinned to, not the
      // (possibly edited) profile, so answers always match the stored chart.
      const k = await getKundaliForSession(db, session.kundaliId);
      if (!k) throw new AppError(409, 'NO_KUNDALI', 'This session’s kundali is missing.');
      const data = AskPanchangKundaliSchema.parse(JSON.parse(k.response_json));
      const req = JSON.parse(k.request_json) as KundaliRequest;
      const timeUncertain = k.time_uncertain === 1;
      const nowSec = Math.floor(Date.now() / 1000);
      const digest = buildChartDigest({
        data,
        timeUncertain,
        asOfSec: nowSec,
        profile: {
          name: req.bd.nm,
          gender: req.bd.g,
          dob: req.bd.dob,
          tob: timeUncertain ? null : req.bd.tob,
          tobUnknown: timeUncertain,
          place: req.bd.loc,
          tz: req.bd.tz,
        },
      });

      const history = (await listMessages(db, session.id))
        .filter((m) => m.status === 'complete' && m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      const messages = buildPrompt({
        lang: session.lang,
        digest,
        today: new Date(nowSec * 1000).toISOString().slice(0, 10),
        timeUncertain,
        history,
        question,
      });

      const { userId, assistantId } = await insertQuestionAndPlaceholder(
        db,
        session.id,
        question,
        PROMPT_VERSION,
      );
      await updateSession(db, session.id, {
        title:
          session.messageCount === 0 && session.title === DEFAULT_SESSION_TITLE
            ? titleFromQuestion(question)
            : undefined,
      });

      const llm = llmFor(c.env);
      const encoder = new TextEncoder();
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const abort = new AbortController();
      let clientGone = false;
      const send = async (event: string, payload: unknown) => {
        if (clientGone) return;
        try {
          await writer.write(encoder.encode(sseEvent(event, payload)));
        } catch {
          clientGone = true; // client disconnected or pressed Stop
          abort.abort();
        }
      };

      const work = (async () => {
        let text = '';
        let tokensIn: number | null = null;
        let tokensOut: number | null = null;
        try {
          await send('start', { userMessageId: userId, messageId: assistantId });
          for await (const ev of llm.stream(messages, abort.signal)) {
            if (ev.type === 'token') {
              text += ev.text;
              await send('token', { text: ev.text });
            } else {
              tokensIn = ev.tokensIn;
              tokensOut = ev.tokensOut;
            }
            if (clientGone) break;
          }
          tokensIn ??= messages.reduce((n, m) => n + estimateTokens(m.content), 0);
          tokensOut ??= estimateTokens(text);
          if (clientGone) {
            await finishAnswer(db, assistantId, {
              content: text ? text + STOPPED_NOTE : '',
              status: text ? 'complete' : 'error',
              tokensIn,
              tokensOut,
            });
          } else if (!text.trim()) {
            await finishAnswer(db, assistantId, {
              content: '',
              status: 'error',
              tokensIn,
              tokensOut,
            });
            await send('error', {
              code: 'AI_EMPTY_ANSWER',
              message: 'The model returned no answer. Try again.',
            });
          } else {
            await finishAnswer(db, assistantId, {
              content: text,
              status: 'complete',
              tokensIn,
              tokensOut,
            });
            await send('done', { messageId: assistantId, tokensIn, tokensOut });
          }
        } catch (err) {
          console.error(
            'qa_answer_failed',
            session.id,
            err instanceof AppError ? err.code : 'unknown',
          );
          await finishAnswer(db, assistantId, {
            content: text,
            status: 'error',
            tokensIn,
            tokensOut,
          });
          const e =
            err instanceof AppError
              ? { code: err.code, message: err.message }
              : { code: 'AI_ERROR', message: 'The answer could not be completed. Try again.' };
          await send('error', e);
        } finally {
          await writer.close().catch(() => {});
        }
      })();
      c.executionCtx.waitUntil(work);

      return new Response(readable, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
        },
      });
    });
}
