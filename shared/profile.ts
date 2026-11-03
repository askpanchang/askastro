import { z } from 'zod';
import { isValidIsoDate, isValidTimeZone, latestTodayIso } from './validation';

export const GENDERS = ['m', 'f', 'o'] as const;
export const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
  m: 'Male',
  f: 'Female',
  o: 'Other',
};

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `${label} is required` : `${label} is too short`)
    .max(max, `${label} must be at most ${max} characters`);

const ProfileFieldsSchema = z.object({
  name: trimmed(1, 120, 'Name'),
  gender: z.enum(GENDERS, { error: 'Choose a gender' }),
  dob: z
    .string()
    .refine(isValidIsoDate, 'Enter a valid date')
    .refine((d) => d >= '1800-01-01', 'Date must be after 1800')
    .refine((d) => d <= latestTodayIso(), 'Date of birth cannot be in the future'),
  tob: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter time as HH:MM (24-hour)')
    .nullable()
    .optional(),
  tobUnknown: z.boolean().default(false),
  place: trimmed(1, 200, 'Place of birth'),
  lat: z.number({ error: 'Latitude is required' }).min(-90).max(90),
  lon: z.number({ error: 'Longitude is required' }).min(-180).max(180),
  tz: z.string().trim().refine(isValidTimeZone, 'Enter a valid IANA time zone, e.g. Asia/Kolkata'),
  notes: z.string().trim().max(2000, 'Notes must be at most 2000 characters').nullable().optional(),
});

/**
 * Body for POST /api/profiles (also used by the form, and to re-validate the
 * merged row on PATCH). Time is required unless marked unknown.
 */
export const ProfileInputSchema = ProfileFieldsSchema.superRefine((v, ctx) => {
  if (!v.tobUnknown && !v.tob) {
    ctx.addIssue({
      code: 'custom',
      path: ['tob'],
      message: 'Enter the time of birth or mark it unknown',
    });
  }
}).transform((v) => ({
  ...v,
  tob: v.tobUnknown ? null : (v.tob ?? null),
  notes: v.notes ? v.notes : null,
}));
export type ProfileInput = z.input<typeof ProfileInputSchema>;
export type ProfileValues = z.output<typeof ProfileInputSchema>;

/** Body for PATCH /api/profiles/:id. Cross-field rules are re-checked on the merged row. */
export const ProfilePatchSchema = ProfileFieldsSchema.partial()
  .extend({ tobUnknown: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type ProfilePatch = z.input<typeof ProfilePatchSchema>;

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  gender: z.enum(GENDERS),
  dob: z.string(),
  tob: z.string().nullable(),
  tobUnknown: z.boolean(),
  place: z.string(),
  lat: z.number(),
  lon: z.number(),
  tz: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const KundaliStatusSchema = z.enum(['none', 'current', 'stale']);
export type KundaliStatus = z.infer<typeof KundaliStatusSchema>;

export const ProfileListItemSchema = ProfileSchema.extend({
  kundaliStatus: KundaliStatusSchema,
  lastSessionAt: z.string().nullable(),
});
export type ProfileListItem = z.infer<typeof ProfileListItemSchema>;

export const ProfileListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const ProfileListSchema = z.object({
  items: z.array(ProfileListItemSchema),
  nextCursor: z.string().nullable(),
});
export type ProfileList = z.infer<typeof ProfileListSchema>;

export const KundaliSummarySchema = z.object({
  id: z.string(),
  ayanamsa: z.string(),
  chartStyle: z.string(),
  lang: z.string(),
  createdAt: z.string(),
  stale: z.boolean(),
});
export type KundaliSummary = z.infer<typeof KundaliSummarySchema>;

export const ProfileDetailSchema = z.object({
  profile: ProfileSchema,
  latestKundali: KundaliSummarySchema.nullable(),
});
export type ProfileDetail = z.infer<typeof ProfileDetailSchema>;

export const ProfileResponseSchema = z.object({ profile: ProfileSchema });
export const OkSchema = z.object({ ok: z.literal(true) });
