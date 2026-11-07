import { describe, expect, it } from "vitest";
import { createClient, InstagramApiError } from "../src/index.js";
import { metric, mockFetch, TOKEN } from "./helpers.js";

const IG = "17841400000000001";

function client(m: ReturnType<typeof mockFetch>, extra: Record<string, unknown> = {}) {
  return createClient({ accessToken: TOKEN, igUserId: IG, fetch: m.fetch, ...extra });
}

describe("createClient", () => {
  it("needs an access token", () => {
    expect(() => createClient({ accessToken: "" })).toThrow(TypeError);
  });

  it("uses graph.facebook.com and v25.0 by default", () => {
    const c = createClient({ accessToken: TOKEN, fetch: mockFetch().fetch });
    expect(c.baseUrl).toBe("https://graph.facebook.com/v25.0");
    expect(c.apiVersion).toBe("v25.0");
  });

  it("takes another API version and rejects a bad one", async () => {
    const m = mockFetch({ body: { id: IG } });
    await client(m, { apiVersion: "v24.0" }).account();
    expect(m.calls[0]!.pathname).toBe(`/v24.0/${IG}`);
    expect(() => createClient({ accessToken: TOKEN, apiVersion: "25" })).toThrow(TypeError);
  });

  it("rejects an id that could change the path", async () => {
    const m = mockFetch();
    await expect(client(m).storyInsights("../me")).rejects.toThrow(TypeError);
    await expect(client(m, { igUserId: undefined }).account()).rejects.toThrow(/igUserId/);
    expect(m.calls).toHaveLength(0);
  });
});

describe("account", () => {
  it("requests the account fields and maps missing ones to null", async () => {
    const m = mockFetch({ body: { id: IG, username: "storylink", followers_count: 1200, media_count: 42 } });
    const a = await client(m).account();
    const url = m.calls[0]!;
    expect(url.origin + url.pathname).toBe(`https://graph.facebook.com/v25.0/${IG}`);
    expect(url.searchParams.get("fields")).toBe(
      "id,username,name,followers_count,follows_count,media_count,profile_picture_url",
    );
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    expect(a).toEqual({
      id: IG,
      username: "storylink",
      name: null,
      followers_count: 1200,
      follows_count: null,
      media_count: 42,
      profile_picture_url: null,
    });
  });

  it("uses a per-call igUserId", async () => {
    const m = mockFetch({ body: { id: "999" } });
    await client(m).account({ igUserId: "999" });
    expect(m.calls[0]!.pathname).toBe("/v25.0/999");
  });
});

describe("stories", () => {
  it("reads /stories with the media fields and follows paging.next", async () => {
    const next = `https://graph.facebook.com/v25.0/${IG}/stories?after=abc&access_token=${TOKEN}`;
    const m = mockFetch(
      { body: { data: [{ id: "1", media_type: "IMAGE", media_product_type: "STORY" }], paging: { next } } },
      { body: { data: [{ id: "2", media_type: "VIDEO" }], paging: {} } },
    );
    const s = await client(m).stories();
    expect(m.calls[0]!.pathname).toBe(`/v25.0/${IG}/stories`);
    expect(m.calls[0]!.searchParams.get("fields")).toBe(
      "id,media_type,media_product_type,timestamp,permalink,caption,media_url,thumbnail_url",
    );
    expect(m.calls[1]!.searchParams.get("after")).toBe("abc");
    expect(s.map((x) => x.id)).toEqual(["1", "2"]);
    expect(s[1]).toMatchObject({ media_product_type: null, media_url: null, caption: null });
  });

  it("does not follow a paging.next URL on another host", async () => {
    const m = mockFetch({ body: { data: [{ id: "1" }], paging: { next: "https://evil.example/steal" } } });
    const s = await client(m).stories();
    expect(s).toHaveLength(1);
    expect(m.calls).toHaveLength(1);
  });
});

describe("media", () => {
  it("builds limit, since, until and after as query params", async () => {
    const m = mockFetch({ body: { data: [{ id: "5" }], paging: { cursors: { after: "c2" }, next: "x" } } });
    const page = await client(m).media({
      limit: 5,
      since: "2026-10-01T00:00:00Z",
      until: new Date("2026-10-08T00:00:00Z"),
      after: "c1",
    });
    const q = m.calls[0]!.searchParams;
    expect(m.calls[0]!.pathname).toBe(`/v25.0/${IG}/media`);
    expect(q.get("limit")).toBe("5");
    expect(q.get("since")).toBe(String(Date.UTC(2026, 9, 1) / 1000));
    expect(q.get("until")).toBe(String(Date.UTC(2026, 9, 8) / 1000));
    expect(q.get("after")).toBe("c1");
    expect(page).toMatchObject({ after: "c2", hasNext: true });
    expect(page.data[0]!.id).toBe("5");
  });

  it("leaves out params that are not set", async () => {
    const m = mockFetch({ body: { data: [] } });
    const page = await client(m).media();
    const keys = [...m.calls[0]!.searchParams.keys()].sort();
    expect(keys).toEqual(["access_token", "fields"]);
    expect(page).toEqual({ data: [], after: null, hasNext: false });
  });

  it("rejects a date that is not valid", async () => {
    await expect(client(mockFetch()).media({ since: "soon" })).rejects.toThrow(TypeError);
  });

  it("iterateMedia follows paging.next and stops at max", async () => {
    const base = `https://graph.facebook.com/v25.0/${IG}/media`;
    const m = mockFetch(
      { body: { data: [{ id: "1" }, { id: "2" }], paging: { next: `${base}?after=p2` } } },
      { body: { data: [{ id: "3" }, { id: "4" }], paging: { next: `${base}?after=p3` } } },
      { body: { data: [{ id: "5" }] } },
    );
    const ids: string[] = [];
    for await (const item of client(m).iterateMedia({ max: 3 })) ids.push(item.id);
    expect(ids).toEqual(["1", "2", "3"]);
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]!.searchParams.get("after")).toBe("p2");
    expect(m.calls[1]!.searchParams.get("access_token")).toBe(TOKEN);
  });

  it("iterateMedia reads every page when there is no max", async () => {
    const base = `https://graph.facebook.com/v25.0/${IG}/media`;
    const m = mockFetch(
      { body: { data: [{ id: "1" }], paging: { next: `${base}?after=p2` } } },
      { body: { data: [{ id: "2" }], paging: {} } },
    );
    const ids: string[] = [];
    for await (const item of client(m).iterateMedia()) ids.push(item.id);
    expect(ids).toEqual(["1", "2"]);
  });
});

describe("media insights", () => {
  it("storyInsights requests the four story metrics", async () => {
    const m = mockFetch({
      body: { data: [metric("views", 120), metric("reach", 95), metric("replies", 3), metric("shares", 1)] },
    });
    const s = await client(m).storyInsights("1789");
    expect(m.calls[0]!.pathname).toBe("/v25.0/1789/insights");
    expect(m.calls[0]!.searchParams.get("metric")).toBe("views,reach,replies,shares");
    expect(s).toEqual({ views: 120, reach: 95, replies: 3, shares: 1 });
  });

  it("maps a missing metric to null", async () => {
    const m = mockFetch({ body: { data: [metric("views", 10), { name: "reach", values: [{}] }] } });
    expect(await client(m).storyInsights("1")).toEqual({ views: 10, reach: null, replies: null, shares: null });
  });

  it("postInsights maps Meta's `saved` to `saves`", async () => {
    const m = mockFetch({
      body: { data: [metric("views", 500), metric("likes", 40), metric("saved", 7), metric("comments", 2)] },
    });
    const p = await client(m).postInsights("2");
    expect(m.calls[0]!.searchParams.get("metric")).toBe("views,reach,likes,comments,saved,shares");
    expect(p).toEqual({ views: 500, reach: null, likes: 40, comments: 2, saves: 7, shares: null });
  });

  it("reelInsights uses views (not the old plays metric)", async () => {
    const m = mockFetch({ body: { data: [metric("views", 900), metric("shares", 4)] } });
    const r = await client(m).reelInsights("3");
    const asked = m.calls[0]!.searchParams.get("metric")!;
    expect(asked).toBe("views,reach,likes,comments,saved,shares");
    expect(asked).not.toMatch(/plays|impressions/);
    expect(r).toMatchObject({ views: 900, shares: 4, saves: null });
  });

  it("reads total_value when values is missing", async () => {
    const m = mockFetch({ body: { data: [{ name: "views", total_value: { value: 77 } }] } });
    expect((await client(m).storyInsights("1")).views).toBe(77);
  });
});

describe("accountInsights", () => {
  it("uses period=day, metric_type=total_value and the default metrics", async () => {
    const m = mockFetch({
      body: {
        data: [
          { name: "views", period: "day", title: "Views", total_value: { value: 3400 } },
          { name: "reach", period: "day", total_value: { value: 1200 } },
        ],
      },
    });
    const rows = await client(m).accountInsights({ since: "2026-10-01", until: "2026-10-08" });
    const q = m.calls[0]!.searchParams;
    expect(m.calls[0]!.pathname).toBe(`/v25.0/${IG}/insights`);
    expect(q.get("metric")).toBe("views,reach,likes,comments,shares,replies");
    expect(q.get("period")).toBe("day");
    expect(q.get("metric_type")).toBe("total_value");
    expect(q.get("since")).toBe(String(Date.UTC(2026, 9, 1) / 1000));
    expect(q.get("until")).toBe(String(Date.UTC(2026, 9, 8) / 1000));
    expect(rows[0]).toEqual({
      name: "views",
      period: "day",
      title: "Views",
      description: null,
      total: 3400,
      values: [],
      breakdowns: [],
    });
  });

  it("passes breakdown and timeframe and parses breakdown results", async () => {
    const m = mockFetch({
      body: {
        data: [
          {
            name: "follower_demographics",
            period: "lifetime",
            total_value: {
              breakdowns: [
                {
                  dimension_keys: ["country"],
                  results: [
                    { dimension_values: ["US"], value: 50 },
                    { dimension_values: ["IL"], value: 20 },
                    { dimension_values: ["XX"] },
                  ],
                },
              ],
            },
          },
        ],
      },
    });
    const rows = await client(m).accountInsights({
      metrics: ["follower_demographics"],
      period: "lifetime",
      breakdown: "country",
      timeframe: "this_month",
    });
    const q = m.calls[0]!.searchParams;
    expect(q.get("breakdown")).toBe("country");
    expect(q.get("timeframe")).toBe("this_month");
    expect(q.get("period")).toBe("lifetime");
    expect(q.has("since")).toBe(false);
    expect(rows[0]!.total).toBeNull();
    expect(rows[0]!.breakdowns[0]!.results).toEqual([
      { dimensionValues: ["US"], value: 50 },
      { dimensionValues: ["IL"], value: 20 },
    ]);
  });

  it("leaves out metric_type when it is null", async () => {
    const m = mockFetch({ body: { data: [] } });
    await client(m).accountInsights({ metrics: ["online_followers"], period: "lifetime", metricType: null });
    expect(m.calls[0]!.searchParams.has("metric_type")).toBe(false);
  });
});

describe("errors", () => {
  const rateLimitBody = {
    error: {
      message: "(#4) Application request limit reached",
      type: "OAuthException",
      code: 4,
      fbtrace_id: "AbC123",
    },
  };

  it("throws InstagramApiError with Meta's fields", async () => {
    const m = mockFetch({ status: 400, body: rateLimitBody });
    const e = (await client(m).account().catch((x: unknown) => x)) as InstagramApiError;
    expect(e).toBeInstanceOf(InstagramApiError);
    expect(e).toMatchObject({
      status: 400,
      code: 4,
      subcode: null,
      type: "OAuthException",
      fbtraceId: "AbC123",
      path: `/v25.0/${IG}`,
    });
    expect(e.isRateLimit).toBe(true);
    expect(e.isAuthError).toBe(false);
    expect(e.message).toContain("Application request limit reached");
  });

  it.each([4, 17, 32, 613, 80001, 80002])("code %i is a rate limit", async (code) => {
    const m = mockFetch({ status: 400, body: { error: { code, message: "limit" } } });
    const e = (await client(m).stories().catch((x: unknown) => x)) as InstagramApiError;
    expect(e.isRateLimit).toBe(true);
  });

  it("code 190 is an auth error", async () => {
    const m = mockFetch({
      status: 400,
      body: { error: { code: 190, error_subcode: 463, type: "OAuthException", message: "Session has expired" } },
    });
    const e = (await client(m).storyInsights("1").catch((x: unknown) => x)) as InstagramApiError;
    expect(e.isAuthError).toBe(true);
    expect(e.isRateLimit).toBe(false);
    expect(e.subcode).toBe(463);
    expect(e.message).toContain("(code 190, subcode 463)");
  });

  it("an auth subcode without code 190 is an auth error", async () => {
    const m = mockFetch({ status: 400, body: { error: { code: 102, error_subcode: 460, message: "x" } } });
    const e = (await client(m).account().catch((x: unknown) => x)) as InstagramApiError;
    expect(e.isAuthError).toBe(true);
  });

  it("throws on a 200 that carries an error body", async () => {
    const m = mockFetch({ status: 200, body: { error: { code: 100, message: "Unsupported get request" } } });
    await expect(client(m).account()).rejects.toMatchObject({ status: 200, code: 100 });
  });

  it("throws on a body that is not JSON", async () => {
    const m = mockFetch({ status: 502 });
    await expect(client(m).account()).rejects.toMatchObject({ status: 502, code: null });
  });

  it("never puts the token in the message, even when Meta echoes it", async () => {
    const m = mockFetch({
      status: 400,
      body: { error: { code: 190, message: `Malformed access token ${TOKEN}` } },
    });
    const e = (await client(m).account().catch((x: unknown) => x)) as InstagramApiError;
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).toContain("[redacted]");
    expect(JSON.stringify(e)).not.toContain(TOKEN);
    expect(String(e.stack)).not.toContain(TOKEN);
  });

  it("wraps a network error with status 0 and no token", async () => {
    const m = mockFetch({ throws: new Error(`connect ECONNREFUSED ?access_token=${TOKEN}`) });
    const e = (await client(m).account().catch((x: unknown) => x)) as InstagramApiError;
    expect(e).toBeInstanceOf(InstagramApiError);
    expect(e.status).toBe(0);
    expect(e.type).toBe("NetworkError");
    expect(e.message).not.toContain(TOKEN);
  });

  it("times out", async () => {
    const slow = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    const c = createClient({ accessToken: TOKEN, igUserId: IG, fetch: slow, timeoutMs: 20 });
    await expect(c.account()).rejects.toMatchObject({ status: 0, type: "Timeout" });
  });
});

describe("usage headers", () => {
  const headers = {
    "x-app-usage": JSON.stringify({ call_count: 28, total_time: 15, total_cputime: 5 }),
    "x-business-use-case-usage": JSON.stringify({
      [IG]: [{ type: "instagram", call_count: 100, total_time: 9, total_cputime: 4, estimated_time_to_regain_access: 12 }],
    }),
  };

  it("lastUsage holds the most recent headers", async () => {
    const m = mockFetch({ body: { id: IG }, headers });
    const c = client(m);
    expect(c.lastUsage).toBeNull();
    await c.account();
    expect(c.lastUsage!.app).toEqual({ call_count: 28, total_time: 15, total_cputime: 5 });
    expect(c.lastUsage!.businessUseCase[IG]![0]).toMatchObject({
      type: "instagram",
      call_count: 100,
      estimated_time_to_regain_access: 12,
    });
  });

  it("puts usage on the error and ignores bad JSON", async () => {
    const m = mockFetch({
      status: 400,
      body: { error: { code: 80002, message: "too many calls" } },
      headers: { ...headers, "x-app-usage": "{not json" },
    });
    const e = (await client(m).account().catch((x: unknown) => x)) as InstagramApiError;
    expect(e.usage!.app).toBeNull();
    expect(e.usage!.businessUseCase[IG]).toHaveLength(1);
  });
});
