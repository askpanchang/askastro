import { z } from 'zod';

/** Standard error envelope returned by every /api route. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthSchema = z.object({
  status: z.literal('ok'),
  app: z.string(),
  db: z.enum(['ok', 'error']),
  time: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;
