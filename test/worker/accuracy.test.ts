import { describe, expect, it } from 'vitest';
import { AskPanchangKundaliSchema } from '../../shared/kundali';
import {
  aspectsOnHouses,
  chalitShifts,
  lordships,
  lordshipTags,
} from '../../worker/services/chartFacts';
import { correctionNote, factCheck, factCheckPeople } from '../../worker/services/factCheck';
import { matchLines, type MatchResult } from '../../worker/services/matchmaking';
import { dashaInRange, detectHorizon, periodLines } from '../../worker/services/periods';
import { detectTopics, topicLines } from '../../worker/services/topics';
import {
  doubleTransitWindows,
  signAt,
  signIntervals,
  transitSignSets,
  weekLines,
  type TransitSnapshot,
} from '../../worker/services/transits';
import arjun from '../fixtures/charts/arjun.json';
import priyaChart from '../fixtures/charts/priya.json';
import matchSample from '../fixtures/matchmaking-sample.json';

const k = AskPanchangKundaliSchema.parse(arjun);
const DAY = 86_400;

describe('chart facts', () => {
  it('derives lordships for a Scorpio Lagna', () => {
    const l = lordships(k);
    expect(l.get(3)).toEqual([1, 6]); // Mars
    expect(l.get(6)).toEqual([7, 12]); // Venus
    expect(l.get(5)).toEqual([2, 5]); // Jupiter
    expect(l.get(2)).toEqual([9]); // Moon
    expect(l.has(8)).toBe(false); // Rahu rules nothing
    expect(lordshipTags([1, 6])).toContain('Lagna lord');
    expect(lordshipTags([4, 9])[0]).toMatch(/Yogakaraka/);
  });

  it('applies the special aspects of Mars, Jupiter and Saturn', () => {
    const a = aspectsOnHouses(k);
    // Saturn in H2 aspects H4 (3rd), H8 (7th), H11 (10th).
    for (const h of [4, 8, 11]) expect(a.get(h)?.some((x) => x.planet === 7)).toBe(true);
    // Mars in H6 aspects H9 (4th), H12 (7th), H1 (8th).
    for (const h of [9, 12, 1]) expect(a.get(h)?.some((x) => x.planet === 3)).toBe(true);
    expect(Array.isArray(chalitShifts(k))).toBe(true);
  });
});

describe('fact check', () => {
  it('flags wrong lordships, signs and houses', () => {
    const issues = factCheck(
      'Moon (7th lord) is exalted. The 10th-lord Mercury helps. Venus is placed in Leo. Mars in the 4th house.',
      k,
    );
    expect(issues.map((i) => i.correction)).toEqual([
      'Moon rules the 9th house, not the 7th.',
      'Mercury rules the 8th and 11th houses, not the 10th.',
      'Venus is in Cancer in the birth chart, not Leo.',
      'Mars is in the 6th house of the birth chart, not the 4th.',
    ]);
    expect(correctionNote(issues)).toContain('**Chart check:**');
  });

  it('accepts correct claims and skips other frames of reference', () => {
    const ok = [
      'Venus, lord of the 7th and 12th, sits in the 9th house.',
      'Mars (1st & 6th lord) is in its own sign.',
      'The Sun in the 9th with Jupiter, lord of the 2nd and 5th, gives fortune.',
      'Jupiter transiting the 10th house supports career.',
      'In the Navamsa, Venus is in Virgo.',
      'Saturn is 11th from the Moon.',
    ];
    for (const s of ok) expect(factCheck(s, k), s).toEqual([]);
  });
});

describe('transits', () => {
  const now = 1_793_750_400; // 2026-11-04
  const snap: TransitSnapshot = {
    asOfSec: now,
    planets: [
      { p: 5, r: 5, deg: 0, min: 30, retro: false }, // Jupiter Leo
      { p: 7, r: 12, deg: 14, min: 50, retro: true }, // Saturn Pisces
    ],
    events: [
      { p: 5, typ: 'rashi', dt: now + 80 * DAY, from: 5, to: 4 }, // Jupiter → Cancer
      { p: 7, typ: 'direct', dt: now + 37 * DAY },
    ],
  };

  it('builds sign intervals from ingress events', () => {
    const iv = signIntervals(snap, 5, now + 365 * DAY);
    expect(iv.map((i) => i.sign)).toEqual([5, 4]);
    expect(iv[0]!.to).toBe(now + 80 * DAY);
  });

  it('finds Jupiter–Saturn double transit windows on a house', () => {
    // Scorpio Lagna: Jupiter in Leo = H10 aspects H2; Saturn in Pisces = H5 aspects H2 (10th).
    const w = doubleTransitWindows(snap, 8, 2);
    expect(w[0]).toEqual({ from: now, to: now + 80 * DAY });
  });
});

describe('next 7 days', () => {
  // Live AskPanchang data for 4–12 Nov 2026 (Lahiri).
  const asOf = 1_793_793_600; // 2026-11-04 12:00 UTC
  const snap: TransitSnapshot = {
    asOfSec: asOf,
    planets: [
      { p: 2, r: 5, deg: 21, min: 9, retro: false }, // Moon Leo
      { p: 3, r: 4, deg: 26, min: 8, retro: false }, // Mars Cancer
      { p: 6, r: 7, deg: 0, min: 28, retro: true }, // Venus Libra
    ],
    events: [],
    week: [
      { p: 2, typ: 'rashi', dt: 1_793_851_486, from: 5, to: 6 },
      { p: 6, typ: 'rashi', dt: 1_793_907_261, from: 7, to: 6 },
      { p: 2, typ: 'rashi', dt: 1_794_051_920, from: 6, to: 7 },
      { p: 2, typ: 'rashi', dt: 1_794_259_107, from: 7, to: 8 },
      { p: 2, typ: 'rashi', dt: 1_794_473_356, from: 8, to: 9 },
      { p: 3, typ: 'rashi', dt: 1_794_494_917, from: 4, to: 5 },
    ],
  };

  it('gives the transiting Moon for each local day, with ingress times', () => {
    const lines = weekLines(k, snap, 'Asia/Kolkata', asOf).filter(Boolean);
    expect(lines[0]).toBe('## NEXT 7 DAYS (transiting Moon each day; times in Asia/Kolkata)');
    const days = lines.slice(1, 8);
    expect(days).toHaveLength(7);
    // Scorpio Lagna, Taurus Moon: Leo = H10 / H4, Virgo = H11 / H5.
    expect(days[0]).toBe('2026-11-04 Wed 4 Nov: Moon in Leo (H10 from Lagna, H4 from Moon)');
    expect(days[1]).toBe(
      '2026-11-05 Thu 5 Nov: Moon in Leo (H10 from Lagna, H4 from Moon); enters Virgo (H11 from Lagna, H5 from Moon) at 09:34',
    );
    expect(days[6]).toMatch(/^2026-11-10 Tue 10 Nov: Moon in Libra .*enters Scorpio .* at 02:48$/);
    expect(lines.slice(8).join('\n')).toMatch(/Venus enters Virgo/);
    expect(signAt(snap, 2, asOf - 12 * 3600)).toBe(5);
    expect(signAt(snap, 2, 1_794_051_921)).toBe(7);
  });

  it('does not flag day-by-day Moon transits as natal errors', () => {
    const answer = [
      '**Thursday (5 Nov):** Moon in Virgo highlights gains.',
      'Day 4: Moon in Libra, your 12th house.',
      'Saturday – the Moon is in Libra, so rest.',
    ].join('\n');
    expect(factCheck(answer, k, transitSignSets(snap))).toEqual([]);
    // A plain natal claim is still checked (Arjun's Moon is in Taurus).
    expect(factCheck('Your Moon is in Virgo.', k, transitSignSets(null))).toHaveLength(1);
  });
});

describe('period forecasts', () => {
  const asOf = 1_793_793_600; // 2026-11-04 12:00 UTC
  const snap: TransitSnapshot = {
    asOfSec: asOf,
    planets: [
      { p: 1, r: 7, deg: 17, min: 51, retro: false }, // Sun Libra
      { p: 5, r: 5, deg: 0, min: 30, retro: false }, // Jupiter Leo
      { p: 7, r: 12, deg: 14, min: 50, retro: true }, // Saturn Pisces R
    ],
    events: [
      { p: 7, typ: 'direct', dt: 1_796_978_000 }, // ~11 Dec 2026
      { p: 5, typ: 'rashi', dt: 1_800_850_000, from: 5, to: 4 }, // ~25 Jan 2027
    ],
  };
  const year = [
    { p: 1, typ: 'rashi', dt: 1_794_847_980, from: 7, to: 8 }, // 16 Nov 2026 19:43 IST
    { p: 1, typ: 'rashi', dt: 1_797_440_000, from: 8, to: 9 }, // ~16 Dec 2026
  ];

  it('detects the longest horizon a question asks for', () => {
    expect(detectHorizon('Weekly predictions day wise')).toBe('week');
    expect(detectHorizon('What will happen tomorrow?')).toBe('week');
    expect(detectHorizon('Monthly predictions, day by day')).toBe('month');
    expect(detectHorizon('Yearly predictions with month wise summary')).toBe('year');
    expect(detectHorizon('What happens in 2027?')).toBe('year');
    expect(detectHorizon('When will I get married?')).toBeNull();
  });

  it('lists dasha periods in the range', () => {
    const d = dashaInRange(k, asOf, asOf + 365 * DAY);
    expect(d.length).toBeGreaterThan(1);
    expect(d[0]!.from).toBeLessThanOrEqual(asOf);
    for (let i = 1; i < d.length; i++) expect(d[i]!.from).toBe(d[i - 1]!.to);
  });

  it('builds a month-by-month table with dated changes', () => {
    const lines = periodLines(k, 'year', {
      tz: 'Asia/Kolkata',
      nowSec: asOf,
      transits: snap,
      events: year,
    });
    const text = lines.join('\n');
    expect(text).toContain('## DASHA PERIODS IN RANGE');
    expect(lines.filter((l) => l.startsWith('### '))).toHaveLength(12);
    // Scorpio Lagna, Taurus Moon.
    expect(text).toContain('### November 2026\nAt today: Sun Libra H12/H6;');
    expect(text).toContain('16 Nov Sun enters Scorpio H1/H7');
    expect(text).toMatch(
      /### December 2026\nAt the start: Sun Scorpio H1\/H7; Jupiter Leo H10\/H4; Saturn Pisces H5\/H11 R\nChanges: 11 Dec Saturn turns direct; 16 Dec Sun enters Sagittarius/,
    );
    // Saturn turned direct in December, so no R in January.
    expect(text).toMatch(
      /### January 2027\nAt the start: Sun Sagittarius[^\n]*Saturn Pisces H5\/H11\n/,
    );
    expect(text).toContain('25 Jan Jupiter enters Cancer H9/H3');
  });

  it('says when the range data is missing instead of leaving a gap', () => {
    const month = periodLines(k, 'month', {
      tz: 'Asia/Kolkata',
      nowSec: asOf,
      transits: null,
      events: null,
    });
    expect(month.join('\n')).toContain('Day-by-day transit data for the month is unavailable.');
  });

  it('checks the dates of stated sign changes', () => {
    const timing = { events: [...snap.events, ...year], tz: 'Asia/Kolkata' };
    const ok = 'The Sun enters Scorpio (your 1st) on 16 Nov. Jupiter enters Cancer on January 25.';
    expect(factCheck(ok, k, undefined, timing)).toEqual([]);
    const wrong = factCheck(
      'In December the Sun enters Scorpio (your 1st) on 16 Dec.',
      k,
      undefined,
      timing,
    );
    expect(wrong.map((i) => i.correction)).toEqual([
      'Sun enters Scorpio on 16 Nov 2026, not 16 Dec.',
    ]);
    // Unknown to the data (out of range): not flagged.
    expect(factCheck('Saturn enters Aries on 3 Jun.', k, undefined, timing)).toEqual([]);
  });
});

describe('topics', () => {
  it('detects question topics without matching plain "house"', () => {
    expect(detectTopics('When will I get married?').map((t) => t.id)).toEqual(['marriage']);
    expect(detectTopics('What does my 7th house say?')).toEqual([]);
    expect(detectTopics('Should I buy a house or change my job?').map((t) => t.id)).toEqual([
      'career',
      'property',
    ]);
  });

  it('joins the relevant houses, significators, varga and dashas', () => {
    const lines = topicLines(k, detectTopics('marriage timing'), {
      gender: 'm',
      tz: 'Asia/Kolkata',
      asOfSec: 1_793_750_400,
      transits: null,
    }).join('\n');
    expect(lines).toContain('H7 (Taurus): lord Venus in Cancer H9');
    expect(lines).toContain('Navamsa (D9)');
    expect(lines).toMatch(
      /Jupiter–Venus 2025-01-03 → 2027-09-04 \(Venus: 7th lord, significator\)/,
    );
  });
});

describe('two charts', () => {
  // Arjun: Scorpio Lagna (Venus rules 7 and 12). Priya: Aquarius Lagna (Venus rules 4 and 9).
  const priya = AskPanchangKundaliSchema.parse(priyaChart);
  const people = [
    { k, name: 'Arjun', aliases: ['Arjun Sharma', 'Arjun'] },
    { k: priya, name: 'Priya', aliases: ['Priya Natarajan', 'Priya'] },
  ];

  it('checks a sentence against the chart of the person it names', () => {
    const issues = factCheckPeople(
      "Priya's Venus, lord of the 7th and 12th, gives devotion.",
      people,
    );
    expect(issues.map((i) => i.correction)).toEqual([
      'Priya: Venus rules the 4th and 9th houses, not the 7th.',
      'Priya: Venus rules the 4th and 9th houses, not the 12th.',
    ]);
    expect(factCheckPeople("Arjun's Venus, lord of the 7th and 12th, is warm.", people)).toEqual(
      [],
    );
  });

  it('uses the heading a line sits under', () => {
    const answer = [
      "### Arjun's chart",
      '- Venus, lord of the 7th and 12th, sits in the 9th house.',
      '**Priya:**',
      '- Venus, lord of the 7th, is strong.',
    ].join('\n');
    expect(factCheckPeople(answer, people).map((i) => i.correction)).toEqual([
      'Priya: Venus rules the 4th and 9th houses, not the 7th.',
    ]);
  });

  it('flags an unattributed claim only when it is wrong for both charts', () => {
    expect(factCheckPeople('Venus, lord of the 7th and 12th, matters here.', people)).toEqual([]);
    const both = factCheckPeople('Venus, lord of the 5th, matters here.', people);
    expect(both).toHaveLength(1);
    expect(both[0]!.correction).toBe(
      'Arjun: Venus rules the 7th and 12th houses, not the 5th. Priya: Venus rules the 4th and 9th houses, not the 5th.',
    );
    expect(correctionNote(both, 2)).toContain('not match these charts');
  });

  it('labels the Guna Milan with names', () => {
    const text = matchLines(matchSample as MatchResult, 'Arjun', 'Priya').join('\n');
    expect(text).toContain('Total: 31.5/36 (Uttam Milan)');
    expect(text).toMatch(/^nadi: 8\/8 \(Arjun: Antya, Priya: Adi\)/m);
    expect(text).not.toMatch(/\bBoy\b|\bGirl\b/);
  });
});
