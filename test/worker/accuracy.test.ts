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
  signIntervals,
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
