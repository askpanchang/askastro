/**
 * Kundali Q&A evaluation: runs the production prompt pipeline (chart digest,
 * live transits, topic focus) against one or more Workers AI models and
 * grades each answer with computed expected facts plus the fact-checker.
 *
 *   npm run eval -- --models @cf/openai/gpt-oss-120b,@cf/deepseek-ai/deepseek-v4.1-flash-1017
 *
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; optional AI_GATEWAY_ID
 * (needed for credits / paid models), ASKPANCHANG_API_BASE, EVAL_OUT.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelSettings } from '../../shared/models';
import { AskPanchangKundaliSchema } from '../../shared/kundali';
import { neuronsFor } from '../../shared/usage';
import { factCheckPeople } from '../../worker/services/factCheck';
import { parseModelStream } from '../../worker/services/llm';
import { buildPrompt } from '../../worker/services/prompts';
import { detectHorizon, fetchPeriodEvents } from '../../worker/services/periods';
import { checkedPeople, questionContext, type Person } from '../../worker/services/questionContext';
import { fetchTransits, transitSignSets, type TransitEvent } from '../../worker/services/transits';
import { CASES, CHARTS } from './cases';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const models = (arg('models', '@cf/openai/gpt-oss-120b') ?? '').split(',').filter(Boolean);
const only = arg('cases')?.split(',');
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const gateway = process.env.AI_GATEWAY_ID ?? arg('gateway');
const outDir = process.env.EVAL_OUT ?? arg('out', 'eval-results')!;
if (!token || !account) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}
const env = {
  ASKPANCHANG_API_BASE:
    process.env.ASKPANCHANG_API_BASE ?? 'https://askpanchang-api-edge.askpanchang.workers.dev',
};

const nowSec = Math.floor(Date.now() / 1000);
// Run from the project root (npm run eval).
const fixtures = join(process.cwd(), 'test/fixtures/charts');

type Result = {
  model: string;
  case: string;
  passed: number;
  total: number;
  errors: number;
  failed: string[];
  issues: string[];
  neurons: number;
  seconds: number;
  answer: string;
};

async function ask(model: string, messages: { role: string; content: string }[]) {
  const s = modelSettings(model);
  const started = Date.now();
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(gateway ? { 'cf-aig-gateway-id': gateway } : {}),
      },
      body: JSON.stringify({
        messages,
        stream: true,
        max_tokens: 8192,
        temperature: s.temperature,
        ...(s.reasoningEffort ? { reasoning_effort: s.reasoningEffort } : {}),
        stream_options: { include_usage: true },
      }),
    },
  );
  if (!res.ok || !res.body)
    throw new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  let text = '';
  let tin = 0;
  let tout = 0;
  for await (const ev of parseModelStream(res.body as ReadableStream<Uint8Array>)) {
    if (ev.type === 'token') text += ev.text;
    else if (ev.type === 'usage') {
      tin = Math.max(tin, ev.tokensIn);
      tout = Math.max(tout, ev.tokensOut);
    }
  }
  return { text, tin, tout, seconds: (Date.now() - started) / 1000 };
}

function loadChart(meta: (typeof CHARTS)[string]) {
  return AskPanchangKundaliSchema.parse(
    JSON.parse(readFileSync(join(fixtures, meta.file), 'utf8')),
  );
}

type CaseT = (typeof CASES)[number];

function personOf(meta: (typeof CHARTS)[string]): Person {
  return {
    k: loadChart(meta),
    timeUncertain: meta.timeUncertain,
    bd: {
      nm: meta.name,
      g: meta.gender,
      dob: meta.dob,
      tob: meta.tob ?? '12:00',
      tz: meta.tz,
      lat: meta.lat,
      lon: meta.lon,
      loc: meta.place,
    },
  };
}

function casePeople(c: CaseT): [Person] | [Person, Person] {
  const p1 = personOf(CHARTS[c.chart]!);
  return c.partner ? [p1, personOf(CHARTS[c.partner.chart]!)] : [p1];
}

/** Grade one answer: expected facts plus the (two-person aware) fact-checker. */
function grade(
  c: CaseT,
  people: Person[],
  answer: string,
  transits: Awaited<ReturnType<typeof fetchTransits>>,
  periodEvents: TransitEvent[] | null,
) {
  const checks = c.checks(people[0]!.k, nowSec, people[1]?.k);
  const failed = checks.filter((ch) => !ch.pass(answer)).map((ch) => ch.name);
  const found = factCheckPeople(
    answer,
    checkedPeople(people),
    transitSignSets(transits, periodEvents ?? []),
    {
      events: [...(transits?.events ?? []), ...(transits?.week ?? []), ...(periodEvents ?? [])],
      tz: people[0]!.bd.tz,
    },
  );
  return { checks, failed, found };
}

/** Re-score saved answers with the current grader and fact-checker (no model calls). */
async function regrade(file: string, transits: Awaited<ReturnType<typeof fetchTransits>>) {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Result[];
  const out: Result[] = [];
  for (const r of saved) {
    const c = CASES.find((x) => x.id === r.case);
    if (!c) {
      out.push(r);
      continue;
    }
    const horizon = detectHorizon(c.question);
    const periodEvents = horizon ? await fetchPeriodEvents(env as Env, nowSec, horizon) : null;
    const { checks, failed, found } = grade(c, casePeople(c), r.answer, transits, periodEvents);
    for (const f of found)
      console.log(`  ${modelSettings(r.model).label} / ${r.case}: "${f.claim}" → ${f.correction}`);
    out.push({
      ...r,
      passed: checks.length - failed.length,
      total: checks.length,
      failed,
      errors: found.length,
      issues: found.map((i) => i.correction),
    });
  }
  return out;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const regradeFile = arg('regrade');
  const results: Result[] = regradeFile
    ? await regrade(regradeFile, await fetchTransits(env as Env, nowSec, 'lahiri'))
    : [];
  if (regradeFile) {
    report(results, [...new Set(results.map((r) => r.model))]);
    return;
  }
  const transits = await fetchTransits(env as Env, nowSec, 'lahiri');
  console.log(`Transits: ${transits ? 'live' : 'unavailable (using generation-day snapshot)'}`);

  for (const model of models) {
    for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
      const people = casePeople(c);
      const { chartData, periodEvents } = await questionContext(env as Env, {
        question: c.question,
        nowSec,
        transits,
        people,
        relation: c.partner?.relation,
      });
      const messages = buildPrompt({
        digest: chartData,
        twoPeople: people.length === 2,
        today: new Date(nowSec * 1000).toISOString().slice(0, 10),
        timeUncertain: people.some((p) => p.timeUncertain),
        history: [],
        question: c.question,
      });
      try {
        const a = await ask(model, messages);
        const { checks, failed, found } = grade(c, people, a.text, transits, periodEvents);
        const issues = found.map((i) => i.correction);
        results.push({
          model,
          case: c.id,
          passed: checks.length - failed.length,
          total: checks.length,
          errors: issues.length,
          failed,
          issues,
          neurons: neuronsFor(model, a.tin, a.tout),
          seconds: a.seconds,
          answer: a.text,
        });
        console.log(
          `${modelSettings(model).label.padEnd(20)} ${c.id.padEnd(16)} ${checks.length - failed.length}/${checks.length}` +
            `${issues.length ? `  ✗ ${issues.length} fact error(s)` : ''}  ${Math.round(neuronsFor(model, a.tin, a.tout))} neurons  ${a.seconds.toFixed(0)}s`,
        );
      } catch (err) {
        console.log(`${model} ${c.id}: FAILED ${(err as Error).message}`);
      }
    }
  }

  report(results, models);
}

function report(results: Result[], models: string[]) {
  // Summary per model
  const lines = [
    '| Model | Facts passed | Fact errors | Avg neurons | Avg seconds |',
    '|---|---|---|---|---|',
  ];
  for (const model of models) {
    const r = results.filter((x) => x.model === model);
    if (!r.length) continue;
    const passed = r.reduce((n, x) => n + x.passed, 0);
    const total = r.reduce((n, x) => n + x.total, 0);
    lines.push(
      `| ${modelSettings(model).label} | ${passed}/${total} (${Math.round((100 * passed) / total)}%) | ${r.reduce((n, x) => n + x.errors, 0)} | ${Math.round(r.reduce((n, x) => n + x.neurons, 0) / r.length)} | ${(r.reduce((n, x) => n + x.seconds, 0) / r.length).toFixed(0)} |`,
    );
  }
  const details = results
    .filter((r) => r.failed.length || r.issues.length)
    .map(
      (r) =>
        `- **${modelSettings(r.model).label} / ${r.case}**: ${[...r.failed.map((f) => `missed "${f}"`), ...r.issues].join('; ')}`,
    );
  const report = `# Kundali Q&A eval (${new Date().toISOString().slice(0, 10)})\n\n${lines.join('\n')}\n\n## Misses and fact errors\n\n${details.join('\n') || 'None.'}\n`;
  writeFileSync(join(outDir, 'report.md'), report);
  writeFileSync(join(outDir, 'answers.json'), JSON.stringify(results, null, 2));
  console.log(`\n${report}\nAnswers: ${join(outDir, 'answers.json')}`);
}

void main();
