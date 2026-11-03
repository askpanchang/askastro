import type { Context } from 'hono';
import { z } from 'zod';
import { AppError } from './errors';

function validationError(error: z.ZodError): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', z.flattenError(error));
}

/** Parse and validate a JSON request body. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/** Validate the query string. */
export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/** Validate an arbitrary value (e.g. a merged PATCH row). */
export function parseValue<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
