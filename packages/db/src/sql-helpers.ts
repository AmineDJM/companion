import { sql, type SQL } from 'drizzle-orm';

/**
 * An explicitly typed timestamp parameter.
 *
 * Drizzle's typed operators (`gte`, `lt`, …) know a column's type and bind a
 * Date correctly. A raw `sql` template does not: the driver has no type to
 * serialise against and the query fails. Any Date inside a raw template must
 * go through this helper, which sends an ISO string with an explicit cast.
 */
export function ts(date: Date): SQL {
  return sql`${date.toISOString()}::timestamptz`;
}

/** The same for a date-only parameter, e.g. `generate_series` bounds. */
export function dateOnly(date: Date): SQL {
  return sql`${date.toISOString().slice(0, 10)}::date`;
}
