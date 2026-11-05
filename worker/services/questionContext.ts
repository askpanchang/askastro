import type { AskPanchangKundali } from '../../shared/kundali';
import { isCouple, type Relation } from '../../shared/session';
import type { KundaliRequest } from './askpanchang';
import { buildChartDigest } from './chartDigest';
import type { CheckedPerson } from './factCheck';
import { fetchMatch, matchLines } from './matchmaking';
import { detectHorizon, fetchPeriodEvents, periodLines } from './periods';
import { detectTopics, topicLines } from './topics';
import type { TransitEvent, TransitSnapshot } from './transits';

/**
 * Everything the model gets about the chart(s) for one question: the digest,
 * topic sheet and period-forecast tables per person, and, for a couple, the
 * AskPanchang Guna Milan. Used by the chat route and the eval script.
 */

export type Person = {
  k: AskPanchangKundali;
  bd: KundaliRequest['bd'];
  timeUncertain: boolean;
};

const RELATION_WORDS: Record<Relation, string> = {
  spouse: 'spouse',
  partner: 'partner',
  parent: 'parent',
  child: 'child',
  sibling: 'sibling',
  friend: 'friend',
  business: 'business partner',
};

export const firstName = (nm: string) => nm.trim().split(/\s+/)[0] ?? nm;

export async function questionContext(
  env: Pick<Env, 'ASKPANCHANG_API_BASE'>,
  args: {
    question: string;
    nowSec: number;
    transits: TransitSnapshot | null;
    people: [Person] | [Person, Person];
    relation?: Relation;
    fetcher?: typeof fetch;
  },
): Promise<{ chartData: string; periodEvents: TransitEvent[] | null }> {
  const { question, nowSec, transits, people } = args;
  const horizon = detectHorizon(question);
  const topics = detectTopics(question);
  const periodEvents = horizon ? await fetchPeriodEvents(env, nowSec, horizon, args.fetcher) : null;

  const personBlock = (p: Person) =>
    [
      buildChartDigest({
        data: p.k,
        timeUncertain: p.timeUncertain,
        asOfSec: nowSec,
        transits,
        profile: {
          name: p.bd.nm,
          gender: p.bd.g,
          dob: p.bd.dob,
          tob: p.timeUncertain ? null : p.bd.tob,
          tobUnknown: p.timeUncertain,
          place: p.bd.loc,
          tz: p.bd.tz,
        },
      }),
      ...topicLines(p.k, topics, { gender: p.bd.g, tz: p.bd.tz, asOfSec: nowSec, transits }),
      ...(horizon
        ? periodLines(p.k, horizon, { tz: p.bd.tz, nowSec, transits, events: periodEvents })
        : []),
    ].join('\n');

  const [p1, p2] = people;
  if (!p2) return { chartData: personBlock(p1), periodEvents };

  const n1 = firstName(p1.bd.nm);
  const n2 = firstName(p2.bd.nm);
  const relation = args.relation ?? 'friend';
  const out = [
    `TWO PEOPLE. PERSON 1 is ${p1.bd.nm} (${n1}); PERSON 2 is ${p2.bd.nm} (${n2}), ${n1}'s ${RELATION_WORDS[relation]}.`,
    '',
    `===== PERSON 1: ${p1.bd.nm} =====`,
    personBlock(p1),
    '',
    `===== PERSON 2: ${p2.bd.nm} (${n1}'s ${RELATION_WORDS[relation]}) =====`,
    personBlock(p2),
  ];

  if (isCouple(relation)) {
    // Traditional matching takes the groom as `a` and the bride as `b`.
    const [a, b] = p1.bd.g === 'f' && p2.bd.g === 'm' ? [p2, p1] : [p1, p2];
    const notes = [
      a.bd.g === b.bd.g || a.bd.g === 'o' || b.bd.g === 'o'
        ? 'Traditional Guna Milan assumes a groom and a bride; treat the score as indicative.'
        : '',
      ...[a, b]
        .filter((p) => p.timeUncertain)
        .map(
          (p) =>
            `${firstName(p.bd.nm)}'s birth time is unknown (cast for noon): kootas depend on the Moon's nakshatra, which may differ.`,
        ),
    ].filter(Boolean);
    const match = await fetchMatch(env, a.bd, b.bd, p1.k.info.ayan, args.fetcher);
    out.push(
      ...(match
        ? matchLines(match, firstName(a.bd.nm), firstName(b.bd.nm), notes.join(' ') || undefined)
        : ['', '## COMPATIBILITY: unavailable right now (matching service unreachable).']),
    );
  }
  return { chartData: out.join('\n'), periodEvents };
}

/** People for `factCheckPeople`: their names tie a sentence to a chart. */
export function checkedPeople(people: Person[]): CheckedPerson[] {
  return people.map((p) => ({
    k: p.k,
    name: firstName(p.bd.nm),
    aliases: [p.bd.nm, firstName(p.bd.nm)],
  }));
}
