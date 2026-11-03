import { z } from 'zod';

export const GeocodeQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(100),
  lang: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default('en'),
});

export const PlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  admin1: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  /** "City, State, Country" */
  label: z.string(),
  lat: z.number(),
  lon: z.number(),
  tz: z.string(),
});
export type Place = z.infer<typeof PlaceSchema>;

export const GeocodeResponseSchema = z.object({ results: z.array(PlaceSchema) });
export type GeocodeResponse = z.infer<typeof GeocodeResponseSchema>;
