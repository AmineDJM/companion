import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

export const primaryId = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
