import { z } from 'zod';

/* ── Options ─────────────────────────────────────────────────────────────── */

/** Only these change the API's result; other names silently fall back to Lahiri. */
export const AYANAMSAS = ['lahiri', 'raman'] as const;
export const AYANAMSA_LABELS: Record<(typeof AYANAMSAS)[number], string> = {
  lahiri: 'Lahiri (Chitrapaksha)',
  raman: 'B. V. Raman',
};
export const CHART_STYLES = ['north', 'south'] as const;
export const LANGS = ['en', 'hi', 'te'] as const;
export const LANG_LABELS: Record<(typeof LANGS)[number], string> = {
  en: 'English',
  hi: 'हिन्दी (Hindi)',
  te: 'తెలుగు (Telugu)',
};

export const KundaliOptionsSchema = z.object({
  ayanamsa: z.enum(AYANAMSAS).default('lahiri'),
  chartStyle: z.enum(CHART_STYLES).default('north'),
  lang: z.enum(LANGS).default('en'),
});
export type KundaliOptions = z.output<typeof KundaliOptionsSchema>;
export type KundaliOptionsInput = z.input<typeof KundaliOptionsSchema>;

/* ── Raw AskPanchang response (parsed leniently; unknown fields pass through) ── */

const int = z.number().int();
const ChartCellSchema = z.looseObject({
  h: int,
  r: int,
  p: z.array(int).default([]),
  asc: z.boolean().optional(),
});
export type ChartCell = z.infer<typeof ChartCellSchema>;

const PlanetSchema = z.looseObject({
  p: int,
  r: int,
  deg: int,
  min: int,
  n: int,
  pd: int,
  h: int,
  dig: int.optional(),
  rx: int.default(0),
  lon: z.number(),
  sl: int.optional(),
  nl: int.optional(),
  r9: int.optional(),
  cmb: int.default(0),
  fl: z.array(z.string()).default([]),
});
export type RawPlanet = z.infer<typeof PlanetSchema>;

const PeriodSchema = z.looseObject({ p: int, from: z.number(), to: z.number() });

const MahadashaSchema = z.looseObject({
  md: int,
  from: z.number(),
  to: z.number(),
  dur: z.number().optional(),
  prog: z.number().optional(),
  ad: z.array(PeriodSchema).default([]),
});
export type Mahadasha = z.infer<typeof MahadashaSchema>;

const TextItemSchema = z.looseObject({ id: z.string(), txt: z.string().default('') });

export const AskPanchangKundaliSchema = z.looseObject({
  cid: z.string().optional(),
  info: z.looseObject({
    nm: z.string().optional(),
    dt: z.number(),
    loc: z.string().optional(),
    lat: z.number(),
    lon: z.number(),
    tz: z.string(),
    ayan: z.string(),
    ayan_val: z.number().optional(),
    node: z.string().optional(),
    asc_deg: int,
    asc_min: int,
    lagna: int,
    rashi: int,
    n: int,
    pd: int,
    age: int.optional(),
  }),
  dasha_now: z
    .looseObject({ md: int, ad: int, pd: int.optional(), sd: int.optional(), prd: int.optional() })
    .optional(),
  charts: z.record(z.string(), z.array(ChartCellSchema)),
  pl: z.array(PlanetSchema),
  houses: z.array(
    z.looseObject({
      h: int,
      r: int,
      lord: int,
      lh: int.optional(),
      p: z.array(int).default([]),
      sav: int.optional(),
    }),
  ),
  aspects: z.array(z.looseObject({ a: int, b: int, typ: int })).default([]),
  dosha: z.array(TextItemSchema.extend({ val: z.number() })).default([]),
  yogas: z.array(TextItemSchema.extend({ q: z.number().optional() })).default([]),
  dasha: z.array(MahadashaSchema),
  shadbala: z
    .array(
      z.looseObject({
        p: int,
        rup: z.number().optional(),
        req: z.number().optional(),
        ratio: z.number().optional(),
      }),
    )
    .default([]),
  birth: z
    .looseObject({
      w: int.optional(),
      t: int.optional(),
      pk: int.optional(),
      y: int.optional(),
      k: int.optional(),
      ma: int.optional(),
      sv: int.optional(),
      sr: z.number().optional(),
      ss: z.number().optional(),
      shaka: int.optional(),
      vikram: int.optional(),
    })
    .optional(),
  readings: z
    .looseObject({
      lang: z.string().optional(),
      lagna: z.string().optional(),
      moon: z.string().optional(),
      nak: z.string().optional(),
      dasha: z.string().optional(),
      planets: z.array(z.looseObject({ p: int, h: int.optional(), txt: z.string() })).default([]),
    })
    .optional(),
  karakas: z
    .looseObject({
      items: z.array(z.looseObject({ k: z.string(), p: int })).default([]),
      karakamsa: int.optional(),
      swamsa: int.optional(),
    })
    .optional(),
  avak: z
    .looseObject({
      varna: int.optional(),
      vashya: int.optional(),
      yoni: int.optional(),
      gana: int.optional(),
      nadi: int.optional(),
    })
    .optional(),
  ss: z
    .array(
      z.looseObject({
        kind: z.string(),
        ph: z.string().optional(),
        r: int.optional(),
        from: z.number(),
        to: z.number(),
      }),
    )
    .default([]),
  transits: z
    .array(
      z.looseObject({
        p: int,
        r: int,
        h: int.optional(),
        rating: z.number().optional(),
        txt: z.string().optional(),
      }),
    )
    .default([]),
});
export type AskPanchangKundali = z.infer<typeof AskPanchangKundaliSchema>;

/* ── App API ─────────────────────────────────────────────────────────────── */

export const KundaliVersionSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  ayanamsa: z.string(),
  chartStyle: z.enum(CHART_STYLES),
  lang: z.string(),
  timeUncertain: z.boolean(),
  stale: z.boolean(),
  createdAt: z.string(),
});
export type KundaliVersion = z.infer<typeof KundaliVersionSchema>;

export const KundaliVersionListSchema = z.object({ items: z.array(KundaliVersionSchema) });

export const KundaliDetailSchema = KundaliVersionSchema.extend({
  data: AskPanchangKundaliSchema,
  digest: z.string(),
});
export type KundaliDetail = z.infer<typeof KundaliDetailSchema>;

export const KundaliResponseSchema = z.object({ kundali: KundaliDetailSchema });
