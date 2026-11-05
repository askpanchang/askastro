import { Hono } from 'hono';
import { AskPanchangKundaliSchema } from '../../shared/kundali';
import {
  AskSchema,
  DEFAULT_SESSION_TITLE,
  SessionCreateSchema,
  SessionPartnerInputSchema,
  SessionPatchSchema,
  titleFromQuestion,
  type SessionDetail,
} from '../../shared/session';
import { sseEvent } from '../../shared/sse';
import { getAccessibleProfile, getLatestKundaliSummary } from '../db/profiles';
import {
  finishAnswer,
  getKundaliForSession,
  getSession,
  hasActiveAnswer,
  insertQuestionAndPlaceholder,
  insertSession,
  latestKundaliId,
  listMessages,
  requestStop,
  saveProgress,
  setPartner,
  listSessions,
  softDeleteSession,
  updateSession,
} from '../db/sessions';
import { AppError } from '../lib/errors';
import { isId } from '../lib/ids';
import { enforceHourlyLimit, limitFor } from '../lib/rateLimit';
import { parseJson, parseValue } from '../lib/validate';
import { enforceDailyAiLimit } from '../services/aiUsage';
import { correctionNote, factCheckPeople } from '../services/factCheck';
import { checkedPeople, questionContext, type Person } from '../services/questionContext';
import { fetchTransits, transitSignSets } from '../services/transits';
import { findDegeneration, type LlmClient } from '../services/llm';
import { activeModel } from '../services/modelChoice';
import { PROMPT_VERSION, buildPrompt, estimateTokens } from '../services/prompts';
import type { KundaliRequest } from '../services/askpanchang';
import type { AppEnv } from '../types';
import { requireProfile } from './profiles';

const notFound = () => new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
export const STOPPED_NOTE = '\n\n_(Answer stopped before it finished.)_';
export const streamTiming = {
  /** Send an SSE comment when nothing was sent for this long. */
  heartbeatMs: 5_000,
  /** How often a running answer is saved and checked for Stop. */
  saveEveryMs: 2_000,
};

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

export function sessionRoutes(llmFor: (env: Env, model: string) => LlmClient) {
  return (
    new Hono<AppEnv>()
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
          throw new AppError(
            409,
            'NO_KUNDALI',
            'Generate a kundali before starting a Q&A session.',
          );
        }
        const id = await insertSession(c.env.DB, {
          ownerId,
          profileId: profile.id,
          kundaliId: latest.id,
          title: DEFAULT_SESSION_TITLE,
          model: await activeModel(c.env),
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
      // Second person (max two charts per session): any profile the user can read.
      .put('/sessions/:id/partner', async (c) => {
        const db = c.env.DB;
        const ownerId = c.get('ownerId');
        const session = await requireSession(db, ownerId, c.req.param('id'));
        const { profileId, relation } = await parseJson(c, SessionPartnerInputSchema);
        if (profileId === session.profileId) {
          throw new AppError(400, 'SAME_PROFILE', 'Choose a different person from this chart.');
        }
        const other = isId(profileId) ? await getAccessibleProfile(db, ownerId, profileId) : null;
        if (!other) throw new AppError(404, 'NOT_FOUND', 'Profile not found');
        const latest = await latestKundaliId(db, profileId);
        if (!latest) {
          throw new AppError(
            409,
            'NO_KUNDALI',
            `Generate a kundali for ${other.profile.name} first.`,
          );
        }
        await setPartner(db, session.id, { profileId, kundaliId: latest.id, relation });
        return c.json({ session: await getSession(db, ownerId, session.id) });
      })
      .delete('/sessions/:id/partner', async (c) => {
        const ownerId = c.get('ownerId');
        const session = await requireSession(c.env.DB, ownerId, c.req.param('id'));
        await setPartner(c.env.DB, session.id, null);
        return c.json({ session: await getSession(c.env.DB, ownerId, session.id) });
      })
      .post('/sessions/:id/stop', async (c) => {
        const session = await requireSession(c.env.DB, c.get('ownerId'), c.req.param('id'));
        return c.json({ ok: true as const, stopping: await requestStop(c.env.DB, session.id) });
      })
      .post('/sessions/:id/messages', async (c) => {
        const db = c.env.DB;
        const session = await requireSession(db, c.get('ownerId'), c.req.param('id'));
        const { question } = await parseJson(c, AskSchema);
        await enforceHourlyLimit(
          db,
          c.get('ownerId'),
          'questions',
          c.get('isAdmin')
            ? limitFor(c.env.RATE_LIMIT_QUESTIONS_PER_HOUR, 30)
            : limitFor(c.env.RATE_LIMIT_FAMILY_QUESTIONS_PER_HOUR, 10),
        );
        await enforceDailyAiLimit(c.env, c.get('ownerId'), c.get('isAdmin'));
        if (await hasActiveAnswer(db, session.id)) {
          throw new AppError(409, 'ANSWER_IN_PROGRESS', 'Wait for the current answer to finish.');
        }

        // Context comes from the kundali this session is pinned to, not the
        // (possibly edited) profile, so answers always match the stored chart.
        const loadPerson = async (kundaliId: string): Promise<Person | null> => {
          const row = await getKundaliForSession(db, kundaliId);
          if (!row) return null;
          return {
            k: AskPanchangKundaliSchema.parse(JSON.parse(row.response_json)),
            bd: (JSON.parse(row.request_json) as KundaliRequest).bd,
            timeUncertain: row.time_uncertain === 1,
          };
        };
        const p1 = await loadPerson(session.kundaliId);
        if (!p1) throw new AppError(409, 'NO_KUNDALI', 'This session’s kundali is missing.');
        // The second person, if any (only while the user can still read that profile).
        const p2 = session.partner ? await loadPerson(session.partner.kundaliId) : null;
        const people: [Person] | [Person, Person] = p2 ? [p1, p2] : [p1];
        const data = p1.k;
        const req = { bd: p1.bd };
        const timeUncertain = people.some((p) => p.timeUncertain);
        const nowSec = Math.floor(Date.now() / 1000);
        // Live transits (cached per day); the answer still works without them.
        const transits = await fetchTransits(c.env, nowSec, data.info.ayan);
        const history = (await listMessages(db, session.id))
          .filter((m) => m.status === 'complete' && m.content)
          .map((m) => ({ role: m.role, content: m.content }));
        // Digest, topic sheet and week/month/year tables per person; Guna Milan for a couple.
        const { chartData: digest, periodEvents } = await questionContext(c.env, {
          question,
          nowSec,
          transits,
          people,
          relation: session.partner?.relation,
        });
        const messages = buildPrompt({
          twoPeople: people.length === 2,
          digest,
          today: new Date(nowSec * 1000).toISOString().slice(0, 10),
          timeUncertain,
          history,
          question,
        });

        // The admin's current pick; each answer records its own model.
        const model = await activeModel(c.env);
        const { userId, assistantId } = await insertQuestionAndPlaceholder(
          db,
          session.id,
          question,
          PROMPT_VERSION,
          model,
        );
        await updateSession(db, session.id, {
          model: session.model !== model ? model : undefined,
          title:
            session.messageCount === 0 && session.title === DEFAULT_SESSION_TITLE
              ? titleFromQuestion(question)
              : undefined,
        });

        const llm = llmFor(c.env, model);
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();
        const abort = new AbortController();
        // A dropped connection doesn't end the answer: it keeps going and is saved,
        // and the chat picks it up again by polling. Only an explicit Stop
        // (POST /api/sessions/:id/stop) ends it early.
        let clientGone = false;
        let stopped = false;
        let lastSent = Date.now();
        const write = async (chunk: string) => {
          if (clientGone) return;
          try {
            await writer.write(encoder.encode(chunk));
            lastSent = Date.now();
          } catch {
            clientGone = true;
          }
        };
        const send = (event: string, payload: unknown) => write(sseEvent(event, payload));
        let lastSaved = Date.now();

        const work = (async () => {
          let text = '';
          let tokensIn: number | null = null;
          let tokensOut: number | null = null;
          try {
            await send('start', { userMessageId: userId, messageId: assistantId });
            for await (const ev of llm.stream(messages, abort.signal)) {
              // Keep the connection alive while the model reasons silently (~20 s for
              // DeepSeek): idle streams can be dropped by browsers and networks.
              if (Date.now() - lastSent >= streamTiming.heartbeatMs) await write(': ping\n\n');
              // Every couple of seconds: save progress and check for Stop.
              if (Date.now() - lastSaved >= streamTiming.saveEveryMs) {
                lastSaved = Date.now();
                if ((await saveProgress(db, assistantId, text)).stopRequested) {
                  stopped = true;
                  abort.abort();
                  break;
                }
              }
              if (ev.type === 'thinking') continue;
              if (ev.type === 'token') {
                text += ev.text;
                // Check the recent tail only, so long answers stay cheap to scan.
                const tailStart = Math.max(0, text.length - ev.text.length - 400);
                const bad = findDegeneration(text.slice(tailStart));
                if (bad >= 0) {
                  text = text.slice(0, tailStart + bad).trimEnd();
                  throw new AppError(
                    502,
                    'AI_MALFORMED_ANSWER',
                    'The answer went off the rails and was stopped. Please ask again.',
                  );
                }
                await send('token', { text: ev.text });
              } else {
                // gpt-oss sends usage on most chunks (sometimes zeros); keep the largest.
                tokensIn = Math.max(tokensIn ?? 0, ev.tokensIn);
                tokensOut = Math.max(tokensOut ?? 0, ev.tokensOut);
              }
            }
            tokensIn ??= messages.reduce((n, m) => n + estimateTokens(m.content), 0);
            tokensOut ??= estimateTokens(text);
            if (stopped) {
              await finishAnswer(db, assistantId, {
                content: text.trim() ? text.trimEnd() + STOPPED_NOTE : '',
                status: text.trim() ? 'complete' : 'error',
                tokensIn,
                tokensOut,
              });
              await send('done', { messageId: assistantId, tokensIn, tokensOut });
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
              // Check stated lordships/signs/houses against the chart; append corrections.
              const note = correctionNote(
                factCheckPeople(
                  text,
                  checkedPeople(people),
                  transitSignSets(transits, periodEvents ?? []),
                  {
                    events: [
                      ...(transits?.events ?? []),
                      ...(transits?.week ?? []),
                      ...(periodEvents ?? []),
                    ],
                    tz: req.bd.tz,
                  },
                ),
                people.length,
              );
              if (note) {
                text += note;
                await send('token', { text: note });
              }
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
      })
  );
}
