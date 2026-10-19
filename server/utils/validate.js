import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    const first = details[0];
    throw badRequest(first.field ? `${first.field}: ${first.message}` : first.message, details);
  }
  return result.data;
}

export const id = z.coerce.number().int().positive();
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM format');
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format');
export const email = z.string().trim().toLowerCase().email();
export const password = z.string().min(6, 'Password must be at least 6 characters').max(100);
export const money = z.coerce.number().int().min(0);
