import { DIGNITY, GRAHA_SANSKRIT, NAKSHATRA, RASHI_SANSKRIT } from './astroLabels.generated';

export * from './astroLabels.generated';

/** AskPanchang planet codes: 1 Sun … 9 Ketu. */
export const PLANETS: Readonly<Record<number, { name: string; abbr: string }>> = {
  1: { name: 'Sun', abbr: 'Su' },
  2: { name: 'Moon', abbr: 'Mo' },
  3: { name: 'Mars', abbr: 'Ma' },
  4: { name: 'Mercury', abbr: 'Me' },
  5: { name: 'Jupiter', abbr: 'Ju' },
  6: { name: 'Venus', abbr: 'Ve' },
  7: { name: 'Saturn', abbr: 'Sa' },
  8: { name: 'Rahu', abbr: 'Ra' },
  9: { name: 'Ketu', abbr: 'Ke' },
};

/** Sign codes: 1 Aries … 12 Pisces. */
export const SIGNS: Readonly<Record<number, { name: string; abbr: string }>> = {
  1: { name: 'Aries', abbr: 'Ar' },
  2: { name: 'Taurus', abbr: 'Ta' },
  3: { name: 'Gemini', abbr: 'Ge' },
  4: { name: 'Cancer', abbr: 'Cn' },
  5: { name: 'Leo', abbr: 'Le' },
  6: { name: 'Virgo', abbr: 'Vi' },
  7: { name: 'Libra', abbr: 'Li' },
  8: { name: 'Scorpio', abbr: 'Sc' },
  9: { name: 'Sagittarius', abbr: 'Sg' },
  10: { name: 'Capricorn', abbr: 'Cp' },
  11: { name: 'Aquarius', abbr: 'Aq' },
  12: { name: 'Pisces', abbr: 'Pi' },
};

export const CHART_NAMES: Readonly<Record<string, string>> = {
  D1: 'Rasi (D1)',
  D2: 'Hora (D2)',
  D3: 'Drekkana (D3)',
  D4: 'Chaturthamsa (D4)',
  D7: 'Saptamsa (D7)',
  D9: 'Navamsa (D9)',
  D10: 'Dasamsa (D10)',
  D12: 'Dwadasamsa (D12)',
  D16: 'Shodasamsa (D16)',
  D20: 'Vimsamsa (D20)',
  D24: 'Chaturvimsamsa (D24)',
  D27: 'Saptavimsamsa (D27)',
  D30: 'Trimsamsa (D30)',
  D40: 'Khavedamsa (D40)',
  D45: 'Akshavedamsa (D45)',
  D60: 'Shashtiamsa (D60)',
  CHALIT: 'Bhava Chalit',
  MOON: 'Chandra Lagna',
  SUN: 'Surya Lagna',
};

export const KARAKA_NAMES: Readonly<Record<string, string>> = {
  AK: 'Atmakaraka',
  AmK: 'Amatyakaraka',
  BK: 'Bhratrikaraka',
  MK: 'Matrikaraka',
  PK: 'Putrakaraka',
  GK: 'Gnatikaraka',
  DK: 'Darakaraka',
};

/** Vimshottari mahadasha lengths in years, by planet code. */
export const VIMSHOTTARI_YEARS: Readonly<Record<number, number>> = {
  9: 7,
  6: 20,
  1: 6,
  2: 10,
  3: 7,
  8: 18,
  5: 16,
  7: 19,
  4: 17,
};
/** Vimshottari order: Ketu, Venus, Sun, Moon, Mars, Rahu, Jupiter, Saturn, Mercury. */
export const VIMSHOTTARI_ORDER = [9, 6, 1, 2, 3, 8, 5, 7, 4] as const;

const lookup = (t: Readonly<Record<number, string>>, code: number, fallback: string) =>
  t[code] ?? `${fallback} ${code}`;

export const planetName = (code: number) => PLANETS[code]?.name ?? `Planet ${code}`;
export const planetAbbr = (code: number) => PLANETS[code]?.abbr ?? `P${code}`;
export const signName = (code: number) => SIGNS[code]?.name ?? `Sign ${code}`;
export const signSanskrit = (code: number) => lookup(RASHI_SANSKRIT, code, 'Rashi');
export const nakshatraName = (code: number) => lookup(NAKSHATRA, code, 'Nakshatra');
export const dignityName = (code: number) => lookup(DIGNITY, code, 'Dignity');
export const grahaSanskrit = (code: number) => lookup(GRAHA_SANSKRIT, code, 'Graha');

/** 26, 28 → "26°28′" */
export const dms = (deg: number, min: number) => `${deg}°${String(min).padStart(2, '0')}′`;

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
