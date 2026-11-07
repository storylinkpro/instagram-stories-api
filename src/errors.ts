import type { RateLimitUsage } from "./usage.js";

/**
 * Meta error codes for rate limits: 4 (app), 17 (user), 32 (page),
 * 613 (call rate), 80001 (Pages use case), 80002 (Instagram use case).
 */
export const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([4, 17, 32, 613, 80001, 80002]);

/** Code 190: the access token is expired, revoked or not valid. */
export const AUTH_ERROR_CODES: ReadonlySet<number> = new Set([190]);

/**
 * Subcodes that mean the user must log in again: 458 (app removed),
 * 460 (password changed), 463 (token expired), 467 (token not valid).
 */
export const AUTH_ERROR_SUBCODES: ReadonlySet<number> = new Set([458, 460, 463, 467]);

export type InstagramApiErrorInit = {
  message: string;
  status: number;
  code?: number | null;
  subcode?: number | null;
  type?: string | null;
  fbtraceId?: string | null;
  path?: string | null;
  usage?: RateLimitUsage | null;
};

/**
 * A failed Graph API call. `message` never contains the access token.
 * `status` is 0 when the request did not reach Meta (network error or timeout).
 */
export class InstagramApiError extends Error {
  /** The HTTP status. 0 for a network error or a timeout. */
  readonly status: number;
  /** Meta's `error.code`. */
  readonly code: number | null;
  /** Meta's `error.error_subcode`. */
  readonly subcode: number | null;
  /** Meta's `error.type`, for example `OAuthException`. */
  readonly type: string | null;
  /** Meta's `error.fbtrace_id`. Give it to Meta support when you report a problem. */
  readonly fbtraceId: string | null;
  /** The API path that failed, without the query string. */
  readonly path: string | null;
  /** The rate-limit usage headers of the failed response, if Meta sent them. */
  readonly usage: RateLimitUsage | null;

  constructor(init: InstagramApiErrorInit) {
    super(init.message);
    this.name = "InstagramApiError";
    this.status = init.status;
    this.code = init.code ?? null;
    this.subcode = init.subcode ?? null;
    this.type = init.type ?? null;
    this.fbtraceId = init.fbtraceId ?? null;
    this.path = init.path ?? null;
    this.usage = init.usage ?? null;
  }

  /** True when Meta throttled the call. Wait before you try again. */
  get isRateLimit(): boolean {
    return this.code !== null && RATE_LIMIT_CODES.has(this.code);
  }

  /** True when the token is expired or not valid (code 190 or an auth subcode). Get a new token. */
  get isAuthError(): boolean {
    if (this.code !== null && AUTH_ERROR_CODES.has(this.code)) return true;
    return this.subcode !== null && AUTH_ERROR_SUBCODES.has(this.subcode);
  }
}

/** Replace every copy of `secret` in `text` with `[redacted]`. */
export function redact(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return text;
  let out = text.split(secret).join("[redacted]");
  const encoded = encodeURIComponent(secret);
  if (encoded !== secret) out = out.split(encoded).join("[redacted]");
  return out;
}
