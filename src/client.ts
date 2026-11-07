import { InstagramApiError, redact } from "./errors.js";
import { toUnixSeconds, type TimeInput } from "./time.js";
import { parseUsageHeaders, type RateLimitUsage } from "./usage.js";

export const DEFAULT_API_VERSION = "v25.0";
export const GRAPH_HOST = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Fields read for every media object (stories, posts and reels). */
export const MEDIA_FIELDS = [
  "id",
  "media_type",
  "media_product_type",
  "timestamp",
  "permalink",
  "caption",
  "media_url",
  "thumbnail_url",
] as const;

/** Fields read by `account()`. */
export const ACCOUNT_FIELDS = [
  "id",
  "username",
  "name",
  "followers_count",
  "follows_count",
  "media_count",
  "profile_picture_url",
] as const;

/** Metrics requested by `storyInsights()`. */
export const STORY_METRICS = ["views", "reach", "replies", "shares"] as const;
/** Metrics requested by `postInsights()`. Meta calls saves `saved`. */
export const POST_METRICS = ["views", "reach", "likes", "comments", "saved", "shares"] as const;
/** Metrics requested by `reelInsights()`. Meta calls saves `saved`. */
export const REEL_METRICS = ["views", "reach", "likes", "comments", "saved", "shares"] as const;
/** Default metrics for `accountInsights()`. */
export const DEFAULT_ACCOUNT_METRICS = ["views", "reach", "likes", "comments", "shares", "replies"] as const;

export type ClientOptions = {
  /** A Facebook User or Page access token with Instagram permissions. */
  accessToken: string;
  /** The Instagram professional account id. Methods can also take it per call. */
  igUserId?: string;
  /** Graph API version. Default `v25.0`. */
  apiVersion?: string;
  /** A `fetch` implementation. Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Abort a request after this many milliseconds. Default 30000. */
  timeoutMs?: number;
};

export type CallOptions = {
  /** Use this account instead of the client's `igUserId`. */
  igUserId?: string;
  signal?: AbortSignal;
};

export type Account = {
  id: string;
  username: string | null;
  name: string | null;
  followers_count: number | null;
  follows_count: number | null;
  media_count: number | null;
  profile_picture_url: string | null;
};

export type MediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | (string & {});
export type MediaProductType = "FEED" | "REELS" | "STORY" | "AD" | (string & {});

export type Media = {
  id: string;
  media_type: MediaType | null;
  media_product_type: MediaProductType | null;
  /** ISO 8601 time the media was published. */
  timestamp: string | null;
  permalink: string | null;
  caption: string | null;
  /** Meta leaves this out for some videos (for example, ones with licensed audio). */
  media_url: string | null;
  thumbnail_url: string | null;
};

export type MediaOptions = CallOptions & {
  /** Items per page. Meta's default is 25. */
  limit?: number;
  since?: TimeInput;
  until?: TimeInput;
  /** A cursor from a previous page's `after`. */
  after?: string;
};

export type MediaPage = {
  data: Media[];
  /** Cursor for the next page, or null on the last page. */
  after: string | null;
  /** True when Meta says there is another page. */
  hasNext: boolean;
};

export type StoryInsights = {
  views: number | null;
  reach: number | null;
  replies: number | null;
  shares: number | null;
};

export type PostInsights = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
};

export type ReelInsights = PostInsights;

export type AccountInsightsOptions = CallOptions & {
  /** Metric names. Default: views, reach, likes, comments, shares, replies. */
  metrics?: readonly string[];
  /** Default `day`. Demographic metrics use `lifetime`. */
  period?: string;
  /** Default `total_value`. Pass `null` to leave it out. */
  metricType?: "total_value" | "time_series" | null;
  since?: TimeInput;
  until?: TimeInput;
  /** For example `media_product_type`, or `age,gender` for demographics. */
  breakdown?: string;
  /** For demographic metrics, for example `this_month`. */
  timeframe?: string;
};

export type AccountInsightBreakdown = {
  dimensionKeys: string[];
  results: Array<{ dimensionValues: string[]; value: number }>;
};

export type AccountInsight = {
  name: string;
  period: string | null;
  title: string | null;
  description: string | null;
  /** `total_value.value` when the metric has one, otherwise null. */
  total: number | null;
  /** Values per period, for `time_series` metrics. */
  values: Array<{ value: unknown; endTime: string | null }>;
  breakdowns: AccountInsightBreakdown[];
};

export type InstagramClient = {
  readonly apiVersion: string;
  readonly baseUrl: string;
  /** Usage headers from the most recent response, or null before the first call. */
  readonly lastUsage: RateLimitUsage | null;
  account(options?: CallOptions): Promise<Account>;
  stories(options?: CallOptions): Promise<Media[]>;
  media(options?: MediaOptions): Promise<MediaPage>;
  iterateMedia(options?: MediaOptions & { max?: number }): AsyncGenerator<Media, void, undefined>;
  storyInsights(mediaId: string, options?: { signal?: AbortSignal }): Promise<StoryInsights>;
  postInsights(mediaId: string, options?: { signal?: AbortSignal }): Promise<PostInsights>;
  reelInsights(mediaId: string, options?: { signal?: AbortSignal }): Promise<ReelInsights>;
  accountInsights(options?: AccountInsightsOptions): Promise<AccountInsight[]>;
};

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

type RawMedia = Partial<Record<(typeof MEDIA_FIELDS)[number], unknown>>;

type ListBody = {
  data?: RawMedia[];
  paging?: { cursors?: { after?: string }; next?: string };
};

type InsightBody = {
  data?: Array<{
    name?: string;
    period?: string;
    title?: string;
    description?: string;
    values?: Array<{ value?: unknown; end_time?: string }>;
    total_value?: {
      value?: unknown;
      breakdowns?: Array<{
        dimension_keys?: string[];
        results?: Array<{ dimension_values?: string[]; value?: unknown }>;
      }>;
    };
  }>;
};

const ID_PATTERN = /^[A-Za-z0-9_]+$/;

function checkId(value: string | undefined, what: string): string {
  if (!value) throw new TypeError(`${what} is required`);
  if (!ID_PATTERN.test(value)) throw new TypeError(`${what} must contain only letters, digits or "_"`);
  return value;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toMedia(raw: RawMedia): Media {
  return {
    id: String(raw.id ?? ""),
    media_type: str(raw.media_type),
    media_product_type: str(raw.media_product_type),
    timestamp: str(raw.timestamp),
    permalink: str(raw.permalink),
    caption: str(raw.caption),
    media_url: str(raw.media_url),
    thumbnail_url: str(raw.thumbnail_url),
  };
}

/** Read one number per metric name. A missing metric stays out of the map. */
function metricValues(body: InsightBody): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of body.data ?? []) {
    if (!row.name) continue;
    const value = num(row.values?.[0]?.value) ?? num(row.total_value?.value);
    if (value !== null) out.set(row.name, value);
  }
  return out;
}

/** Aborts when either signal aborts. `AbortSignal.any` needs Node 20.3+, so
 *  older runtimes link the two by hand and keep the timeout. */
function combineSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const any = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([a, b]);
  const ctrl = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

export function createClient(options: ClientOptions): InstagramClient {
  if (!options || typeof options.accessToken !== "string" || options.accessToken.length === 0) {
    throw new TypeError("accessToken is required");
  }
  const token = options.accessToken;
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new TypeError(`apiVersion must look like "v25.0", got "${apiVersion}"`);
  }
  const baseUrl = `${GRAPH_HOST}/${apiVersion}`;
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new TypeError("No fetch available. Use Node 20+ or pass options.fetch");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastUsage: RateLimitUsage | null = null;

  const userId = (o?: CallOptions) => checkId(o?.igUserId ?? options.igUserId, "igUserId");

  async function call<T>(url: URL, signal?: AbortSignal): Promise<T> {
    // The token goes in a header, not the query string, so it stays out of
    // proxy and server logs. Meta adds it to `paging.next` URLs: remove it.
    url.searchParams.delete("access_token");
    const path = url.pathname;
    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: combineSignals(signal, AbortSignal.timeout(timeoutMs)),
      });
    } catch (e) {
      const isTimeout = e instanceof Error && e.name === "TimeoutError";
      const reason = isTimeout
        ? `timed out after ${timeoutMs} ms`
        : e instanceof Error
          ? e.message
          : String(e);
      throw new InstagramApiError({
        message: redact(`Request to ${path} failed: ${reason}`, token),
        status: 0,
        type: isTimeout ? "Timeout" : "NetworkError",
        path,
      });
    }

    const usage = parseUsageHeaders(res.headers);
    lastUsage = usage;
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const err = (body as GraphErrorBody | null)?.error;
    if (!res.ok || err) {
      const detail = err?.message ?? `HTTP ${res.status}`;
      const codes = [
        err?.code !== undefined ? `code ${err.code}` : null,
        err?.error_subcode !== undefined ? `subcode ${err.error_subcode}` : null,
      ].filter(Boolean);
      throw new InstagramApiError({
        message: redact(
          `Instagram API error at ${path}: ${detail}${codes.length ? ` (${codes.join(", ")})` : ""}`,
          token,
        ),
        status: res.status,
        code: num(err?.code),
        subcode: num(err?.error_subcode),
        type: str(err?.type),
        fbtraceId: str(err?.fbtrace_id),
        path,
        usage,
      });
    }
    if (body === null || typeof body !== "object") {
      throw new InstagramApiError({
        message: `Instagram API returned a response that is not JSON at ${path}`,
        status: res.status,
        path,
        usage,
      });
    }
    return body as T;
  }

  function endpoint(path: string, params: Record<string, string | undefined> = {}): URL {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    return url;
  }

  /** Accept a `paging.next` URL only when it points at the same Graph host. */
  function nextUrl(next: string | undefined): URL | null {
    if (!next) return null;
    let url: URL;
    try {
      url = new URL(next);
    } catch {
      return null;
    }
    return url.origin === GRAPH_HOST ? url : null;
  }

  async function mediaInsights(mediaId: string, metrics: readonly string[], signal?: AbortSignal) {
    const id = checkId(mediaId, "mediaId");
    const body = await call<InsightBody>(endpoint(`/${id}/insights`, { metric: metrics.join(",") }), signal);
    const values = metricValues(body);
    return (name: string) => values.get(name) ?? null;
  }

  function mediaParams(o: MediaOptions): Record<string, string | undefined> {
    return {
      fields: MEDIA_FIELDS.join(","),
      limit: o.limit !== undefined ? String(o.limit) : undefined,
      since: o.since !== undefined ? String(toUnixSeconds(o.since)) : undefined,
      until: o.until !== undefined ? String(toUnixSeconds(o.until)) : undefined,
      after: o.after,
    };
  }

  function toPage(body: ListBody): MediaPage {
    return {
      data: (body.data ?? []).map(toMedia),
      after: body.paging?.cursors?.after ?? null,
      hasNext: Boolean(body.paging?.next),
    };
  }

  const client: InstagramClient = {
    apiVersion,
    baseUrl,
    get lastUsage() {
      return lastUsage;
    },

    async account(o) {
      const raw = await call<Record<string, unknown>>(
        endpoint(`/${userId(o)}`, { fields: ACCOUNT_FIELDS.join(",") }),
        o?.signal,
      );
      return {
        id: String(raw.id ?? userId(o)),
        username: str(raw.username),
        name: str(raw.name),
        followers_count: num(raw.followers_count),
        follows_count: num(raw.follows_count),
        media_count: num(raw.media_count),
        profile_picture_url: str(raw.profile_picture_url),
      };
    },

    async stories(o) {
      const out: Media[] = [];
      let url: URL | null = endpoint(`/${userId(o)}/stories`, { fields: MEDIA_FIELDS.join(",") });
      while (url) {
        const body: ListBody = await call<ListBody>(url, o?.signal);
        out.push(...(body.data ?? []).map(toMedia));
        url = nextUrl(body.paging?.next);
      }
      return out;
    },

    async media(o = {}) {
      return toPage(await call<ListBody>(endpoint(`/${userId(o)}/media`, mediaParams(o)), o.signal));
    },

    async *iterateMedia(o = {}) {
      const max = o.max ?? Infinity;
      let count = 0;
      let url: URL | null = endpoint(`/${userId(o)}/media`, mediaParams(o));
      while (url && count < max) {
        const body: ListBody = await call<ListBody>(url, o.signal);
        for (const raw of body.data ?? []) {
          yield toMedia(raw);
          if (++count >= max) return;
        }
        url = nextUrl(body.paging?.next);
      }
    },

    async storyInsights(mediaId, o) {
      const get = await mediaInsights(mediaId, STORY_METRICS, o?.signal);
      return { views: get("views"), reach: get("reach"), replies: get("replies"), shares: get("shares") };
    },

    async postInsights(mediaId, o) {
      const get = await mediaInsights(mediaId, POST_METRICS, o?.signal);
      return {
        views: get("views"),
        reach: get("reach"),
        likes: get("likes"),
        comments: get("comments"),
        saves: get("saved"),
        shares: get("shares"),
      };
    },

    async reelInsights(mediaId, o) {
      const get = await mediaInsights(mediaId, REEL_METRICS, o?.signal);
      return {
        views: get("views"),
        reach: get("reach"),
        likes: get("likes"),
        comments: get("comments"),
        saves: get("saved"),
        shares: get("shares"),
      };
    },

    async accountInsights(o = {}) {
      const metrics = o.metrics ?? DEFAULT_ACCOUNT_METRICS;
      if (metrics.length === 0) throw new TypeError("metrics must not be empty");
      const metricType = o.metricType === undefined ? "total_value" : o.metricType;
      const body = await call<InsightBody>(
        endpoint(`/${userId(o)}/insights`, {
          metric: metrics.join(","),
          period: o.period ?? "day",
          metric_type: metricType ?? undefined,
          since: o.since !== undefined ? String(toUnixSeconds(o.since)) : undefined,
          until: o.until !== undefined ? String(toUnixSeconds(o.until)) : undefined,
          breakdown: o.breakdown,
          timeframe: o.timeframe,
        }),
        o.signal,
      );
      return (body.data ?? []).map((row) => ({
        name: row.name ?? "",
        period: str(row.period),
        title: str(row.title),
        description: str(row.description),
        total: num(row.total_value?.value),
        values: (row.values ?? []).map((v) => ({ value: v.value ?? null, endTime: str(v.end_time) })),
        breakdowns: (row.total_value?.breakdowns ?? []).map((b) => ({
          dimensionKeys: b.dimension_keys ?? [],
          results: (b.results ?? [])
            .filter((r) => Array.isArray(r.dimension_values) && num(r.value) !== null)
            .map((r) => ({ dimensionValues: r.dimension_values!, value: r.value as number })),
        })),
      }));
    },
  };
  return client;
}
