import { neuronsFor, utcDay, type Usage } from '../../shared/usage';
import { AppError } from '../lib/errors';
import { isAdminUser } from '../lib/owner';

type PersonTotals = { email: string; neurons: number; questions: number };

const DAY_MS = 24 * 3600_000;

export function dailyLimits(env: Pick<Env, 'AI_DAILY_NEURON_BUDGET' | 'AI_USER_DAILY_NEURONS'>) {
  const budget = Number(env.AI_DAILY_NEURON_BUDGET);
  const user = Number(env.AI_USER_DAILY_NEURONS);
  return {
    budget: Number.isFinite(budget) && budget > 0 ? budget : 10_000,
    userLimit: Number.isFinite(user) && user > 0 ? user : 5_000,
  };
}

/**
 * This app's AI usage per person between two instants, from stored answers:
 * neurons are estimated from each answer's token counts and its session's model.
 */
export async function appUsageByPerson(
  db: D1Database,
  fromIso: string,
  toIso: string,
): Promise<PersonTotals[]> {
  const { results } = await db
    .prepare(
      `SELECT s.owner_id AS email, s.model AS model,
         SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(m.tokens_in, 0) ELSE 0 END) AS tin,
         SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(m.tokens_out, 0) ELSE 0 END) AS tout,
         SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS questions
       FROM qa_messages m JOIN qa_sessions s ON s.id = m.session_id
       WHERE m.created_at >= ? AND m.created_at < ?
       GROUP BY s.owner_id, s.model`,
    )
    .bind(fromIso, toIso)
    .all<{ email: string; model: string; tin: number; tout: number; questions: number }>();
  const byPerson = new Map<string, PersonTotals>();
  for (const r of results) {
    const p = byPerson.get(r.email) ?? { email: r.email, neurons: 0, questions: 0 };
    p.neurons += neuronsFor(r.model, r.tin, r.tout);
    p.questions += r.questions;
    byPerson.set(r.email, p);
  }
  return [...byPerson.values()].sort((a, b) => b.neurons - a.neurons);
}

/** Tests can replace the GraphQL call. */
export const analytics = {
  endpoint: 'https://api.cloudflare.com/client/v4/graphql',
};

/**
 * Account-wide Workers AI neurons per UTC day (all Workers and models in the
 * account), from Cloudflare's GraphQL Analytics API. Cached for 60 s.
 * Returns null when no analytics token is configured or the call fails.
 */
export async function accountNeuronsByDay(
  env: Pick<Env, 'CF_ANALYTICS_TOKEN' | 'CF_ACCOUNT_ID'>,
  fromDay: string,
  toDay: string,
): Promise<Map<string, number> | null> {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return null;
  const cacheKey = new Request(
    `https://ai-usage-cache.internal/v1?a=${env.CF_ACCOUNT_ID}&f=${fromDay}&t=${toDay}`,
  );
  const cache = await caches.open('ai-usage');
  const hit = await cache.match(cacheKey);
  if (hit) return new Map(Object.entries((await hit.json()) as Record<string, number>));

  const query = `query($a: String!, $f: Date!, $t: Date!) {
    viewer { accounts(filter: { accountTag: $a }) {
      aiInferenceAdaptiveGroups(limit: 1000, filter: { date_geq: $f, date_leq: $t }) {
        sum { totalNeurons } dimensions { date }
      } } } }`;
  try {
    const res = await fetch(analytics.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { a: env.CF_ACCOUNT_ID, f: fromDay, t: toDay },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('ai_usage_analytics_status', res.status);
      return null;
    }
    const body = (await res.json()) as {
      errors?: unknown[] | null;
      data?: {
        viewer?: {
          accounts?: {
            aiInferenceAdaptiveGroups?: {
              sum: { totalNeurons: number };
              dimensions: { date: string };
            }[];
          }[];
        };
      };
    };
    if (body.errors?.length) {
      console.error('ai_usage_analytics_errors', body.errors.length);
      return null;
    }
    const totals: Record<string, number> = {};
    for (const g of body.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? []) {
      totals[g.dimensions.date] = (totals[g.dimensions.date] ?? 0) + (g.sum.totalNeurons ?? 0);
    }
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(totals), { headers: { 'cache-control': 'max-age=60' } }),
    );
    return new Map(Object.entries(totals));
  } catch {
    console.error('ai_usage_analytics_unreachable');
    return null;
  }
}

/** Today's usage for one person and the account; admins also get people and history. */
export async function buildUsage(
  env: Env,
  userId: string,
  isAdmin: boolean,
  nowMs = Date.now(),
): Promise<Usage> {
  const { day, start, resetsAt } = utcDay(nowMs);
  const { budget, userLimit } = dailyLimits(env);
  const weekStartMs = new Date(start).getTime() - 6 * DAY_MS;
  const weekStartDay = new Date(weekStartMs).toISOString().slice(0, 10);

  const [today, account] = await Promise.all([
    appUsageByPerson(env.DB, start, resetsAt),
    accountNeuronsByDay(env, isAdmin ? weekStartDay : day, day),
  ]);
  const me = today.find((p) => p.email === userId);
  const appTotal = today.reduce((n, p) => n + p.neurons, 0);
  const accountToday = account?.get(day);

  const usage: Usage = {
    day,
    resetsAt,
    budget,
    userLimit: isAdmin ? null : userLimit,
    memberLimit: userLimit,
    you: { neurons: round(me?.neurons ?? 0), questions: me?.questions ?? 0 },
    // Cloudflare's analytics lag by a minute or so; never show less than this app alone used.
    account: account
      ? { neurons: round(Math.max(accountToday ?? 0, appTotal)), source: 'cloudflare' }
      : { neurons: round(appTotal), source: 'estimate' },
  };

  if (isAdmin) {
    usage.people = today.map((p) => ({
      ...p,
      neurons: round(p.neurons),
      limit: isAdminUser(env, p.email) ? null : userLimit,
    }));
    const history: NonNullable<Usage['history']> = [];
    for (let i = 0; i < 7; i++) {
      const dStart = new Date(weekStartMs + i * DAY_MS);
      const d = dStart.toISOString().slice(0, 10);
      const app =
        d === day
          ? appTotal
          : (
              await appUsageByPerson(
                env.DB,
                dStart.toISOString(),
                new Date(dStart.getTime() + DAY_MS).toISOString(),
              )
            ).reduce((n, p) => n + p.neurons, 0);
      history.push({
        day: d,
        appNeurons: round(app),
        accountNeurons: account ? round(account.get(d) ?? 0) : null,
      });
    }
    usage.history = history;
  }
  return usage;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Seconds until the next 00:00 UTC. */
export function secondsUntilReset(nowMs = Date.now()) {
  return Math.max(1, Math.ceil((new Date(utcDay(nowMs).resetsAt).getTime() - nowMs) / 1000));
}

/**
 * Refuse a new question once a non-admin has used their daily neuron limit.
 * Admins have no app-imposed cap: they can use the whole free allowance and
 * any prepaid credits. When the account itself runs out, Workers AI refuses
 * the call (error 4006), which the LLM adapter turns into ACCOUNT_AI_LIMIT.
 */
export async function enforceDailyAiLimit(
  env: Env,
  userId: string,
  isAdmin: boolean,
  nowMs = Date.now(),
) {
  if (isAdmin) return;
  const { start, resetsAt } = utcDay(nowMs);
  const { userLimit } = dailyLimits(env);
  const today = await appUsageByPerson(env.DB, start, resetsAt);
  const mine = today.find((p) => p.email === userId)?.neurons ?? 0;
  if (mine >= userLimit) {
    throw new AppError(
      429,
      'DAILY_AI_LIMIT',
      "You've used today's AI allowance. It resets at 00:00 UTC (5:30 AM IST).",
      { retryAfter: secondsUntilReset(nowMs), resetsAt },
    );
  }
}
