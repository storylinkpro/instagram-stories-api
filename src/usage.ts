/**
 * Meta's rate-limit usage headers. Each value is a percentage of the limit
 * (0-100). Meta throttles when any one of them reaches 100.
 */
export type AppUsage = {
  call_count: number;
  total_time: number;
  total_cputime: number;
};

export type BusinessUseCaseUsage = AppUsage & {
  /** The use case, for example `instagram` or `pages`. */
  type: string;
  /** Minutes until the app can call again. 0 when not throttled. */
  estimated_time_to_regain_access: number;
};

export type RateLimitUsage = {
  /** From `x-app-usage`. Null when the header is missing. */
  app: AppUsage | null;
  /** From `x-business-use-case-usage`, keyed by business object id. */
  businessUseCase: Record<string, BusinessUseCaseUsage[]>;
};

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pct(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;
}

function toAppUsage(raw: unknown): AppUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    call_count: pct(o.call_count),
    total_time: pct(o.total_time),
    total_cputime: pct(o.total_cputime),
  };
}

function toBuc(raw: unknown): Record<string, BusinessUseCaseUsage[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, BusinessUseCaseUsage[]> = {};
  for (const [id, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const parsed: BusinessUseCaseUsage[] = [];
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      parsed.push({
        type: typeof o.type === "string" ? o.type : "unknown",
        call_count: pct(o.call_count),
        total_time: pct(o.total_time),
        total_cputime: pct(o.total_cputime),
        estimated_time_to_regain_access: pct(o.estimated_time_to_regain_access),
      });
    }
    if (parsed.length > 0) out[id] = parsed;
  }
  return out;
}

/** Parse `x-app-usage` and `x-business-use-case-usage`. Bad JSON gives empty values. */
export function parseUsageHeaders(headers: Headers): RateLimitUsage {
  return {
    app: toAppUsage(parseJson(headers.get("x-app-usage"))),
    businessUseCase: toBuc(parseJson(headers.get("x-business-use-case-usage"))),
  };
}
