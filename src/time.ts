/**
 * A point in time: a `Date`, epoch milliseconds, or a date string such as
 * `2026-10-01` or `2026-10-01T12:00:00Z`.
 */
export type TimeInput = Date | number | string;

/** Convert a `TimeInput` to Unix seconds, the unit Graph API `since`/`until` use. */
export function toUnixSeconds(input: TimeInput): number {
  const ms =
    input instanceof Date ? input.getTime() : typeof input === "number" ? input : Date.parse(input);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`Not a valid date: ${String(input)}`);
  }
  return Math.floor(ms / 1000);
}
