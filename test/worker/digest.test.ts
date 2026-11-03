import { describe, expect, it } from 'vitest';
import { currentDasha, subPeriods } from '../../shared/dasha';
import { AskPanchangKundaliSchema } from '../../shared/kundali';
import { buildChartDigest } from '../../worker/services/chartDigest';
import fixture from '../fixtures/askpanchang-sample.json';

const data = AskPanchangKundaliSchema.parse(fixture);
const profile = {
  name: 'Arjun Sharma',
  gender: 'm' as const,
  dob: '1990-08-15',
  tob: '14:30',
  tobUnknown: false,
  place: 'Hyderabad, Telangana, India',
  tz: 'Asia/Kolkata',
};
// The fixture was generated on this date; its dasha_now is Jupiter / Venus / Saturn.
const AS_OF = Date.UTC(2026, 10, 3) / 1000;

describe('chart digest', () => {
  it('matches the snapshot for the fixture', () => {
    const digest = buildChartDigest({ data, profile, timeUncertain: false, asOfSec: AS_OF });
    expect(digest).toMatchSnapshot();
    // Stay well within the ~3–4k token budget (≈3.6 chars per token).
    expect(digest.length / 3.6).toBeLessThan(3000);
  });

  it('is deterministic', () => {
    const a = buildChartDigest({ data, profile, timeUncertain: false, asOfSec: AS_OF });
    const b = buildChartDigest({ data, profile, timeUncertain: false, asOfSec: AS_OF });
    expect(a).toBe(b);
  });
});

describe('dasha helpers', () => {
  it("computes the same current periods as the API's dasha_now", () => {
    const cur = currentDasha(data, AS_OF);
    expect([cur?.md.lord, cur?.ad?.lord, cur?.pd?.lord]).toEqual([
      data.dasha_now?.md,
      data.dasha_now?.ad,
      data.dasha_now?.pd,
    ]);
  });

  it('splits a period into nine contiguous sub-periods starting with its lord', () => {
    const parent = { lord: 6, from: 1000, to: 1000 + 120 * 1000 };
    const subs = subPeriods(parent);
    expect(subs.map((s) => s.lord)).toEqual([6, 1, 2, 3, 8, 5, 7, 4, 9]);
    expect(subs[0]?.from).toBe(parent.from);
    expect(subs.at(-1)?.to).toBe(parent.to);
    expect(subs[0]!.to - subs[0]!.from).toBe(20 * 1000);
    subs.slice(1).forEach((s, i) => expect(s.from).toBe(subs[i]!.to));
  });
});
