import { describe, expect, it } from 'vitest';
import { AskPanchangKundaliSchema } from '../../shared/kundali';
import {
  aspectsOnHouses,
  chalitShifts,
  lordships,
  lordshipTags,
} from '../../worker/services/chartFacts';
import { correctionNote, factCheck } from '../../worker/services/factCheck';
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
