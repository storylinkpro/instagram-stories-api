import { describe, expect, it } from "vitest";
import { parseWhen, run, table } from "../src/cli.js";
import { metric, mockFetch, TOKEN, type Reply } from "./helpers.js";

const IG = "17841400000000001";
const NOW = new Date("2026-11-07T12:00:00Z");

async function cli(argv: string[], replies: Reply[] = [], env: Record<string, string> = {}) {
  const m = mockFetch(...replies);
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    env: { INSTAGRAM_ACCESS_TOKEN: TOKEN, INSTAGRAM_USER_ID: IG, ...env },
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
    fetch: m.fetch,
    now: () => NOW,
  });
  expect(stdout + stderr).not.toContain(TOKEN);
  return { code, stdout, stderr, calls: m.calls, auths: m.auths };
}

describe("help and usage errors", () => {
  it("--help prints the command table and exits 0", async () => {
    const r = await cli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("account-insights");
    expect(r.stdout).toContain("Unofficial");
  });

  it("no command prints help to stderr and exits 2", async () => {
    const r = await cli([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Usage:");
  });

  it.each(["account", "stories", "media", "insights", "account-insights"])("%s --help exits 0", async (cmd) => {
    const r = await cli([cmd, "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`instagram-stories-api ${cmd}`);
    expect(r.calls).toHaveLength(0);
  });

  it.each([
    [["nope"], /Unknown command/],
    [["account", "--bogus"], /Unknown option/],
    [["media", "--limit", "0"], /--limit/],
    [["media", "--limit", "abc"], /--limit/],
    [["insights"], /Missing <media-id>/],
    [["insights", "1", "--type", "igtv"], /--type/],
    [["insights", "../x"], /media-id/],
    [["account-insights", "--since", "lastweek"], /Not a valid time/],
    [["account-insights", "--since", "1d", "--until", "2d"], /before/],
    [["account", "extra"], /Unexpected argument/],
    [["account", "--api-version", "25"], /apiVersion/],
  ])("%j exits 2", async (argv, msg) => {
    const r = await cli(argv as string[]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(msg);
    expect(r.calls).toHaveLength(0);
  });

  it("needs a token", async () => {
    const r = await cli(["account"], [], { INSTAGRAM_ACCESS_TOKEN: "" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("INSTAGRAM_ACCESS_TOKEN");
  });

  it("needs an account id", async () => {
    const r = await cli(["stories"], [], { INSTAGRAM_USER_ID: "" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("INSTAGRAM_USER_ID");
  });
});

describe("token and account sources", () => {
  it("--token and --account win over the env", async () => {
    const r = await cli(["account", "--token", "EAAflagTOKENxyz", "--account", "42"], [{ body: { id: "42" } }]);
    expect(r.code).toBe(0);
    expect(r.calls[0]!.pathname).toBe("/v25.0/42");
    expect(r.auths[0]).toBe("Bearer EAAflagTOKENxyz");
    expect(r.calls[0]!.searchParams.has("access_token")).toBe(false);
    expect(r.stdout).not.toContain("EAAflagTOKENxyz");
  });

  it("--api-version changes the path", async () => {
    const r = await cli(["account", "--api-version", "v24.0"], [{ body: { id: IG } }]);
    expect(r.calls[0]!.pathname).toBe(`/v24.0/${IG}`);
  });
});

describe("commands", () => {
  it("account prints a table", async () => {
    const r = await cli(["account"], [{ body: { id: IG, username: "storylink", followers_count: 1234 } }]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/username\s+storylink/);
    expect(r.stdout).toMatch(/followers\s+1,234/);
  });

  it("account --json prints JSON", async () => {
    const r = await cli(["account", "--json"], [{ body: { id: IG, username: "storylink" } }]);
    expect(JSON.parse(r.stdout)).toMatchObject({ id: IG, username: "storylink", name: null });
  });

  it("stories prints each story", async () => {
    const r = await cli(
      ["stories"],
      [{ body: { data: [{ id: "111", media_type: "IMAGE", timestamp: "2026-11-07T08:30:00+0000", permalink: "https://instagram.com/stories/x/111" }] } }],
    );
    expect(r.stdout).toMatch(/111\s+IMAGE\s+2026-11-07 08:30/);
  });

  it("stories says when there are none", async () => {
    const r = await cli(["stories"], [{ body: { data: [] } }]);
    expect(r.stdout).toContain("No current stories.");
  });

  it("media --limit pages through results", async () => {
    const next = `https://graph.facebook.com/v25.0/${IG}/media?after=p2`;
    const r = await cli(
      ["media", "-n", "3", "--json"],
      [
        { body: { data: [{ id: "1" }, { id: "2" }], paging: { next } } },
        { body: { data: [{ id: "3" }, { id: "4" }] } },
      ],
    );
    expect(r.code).toBe(0);
    expect(r.calls[0]!.searchParams.get("limit")).toBe("3");
    expect(JSON.parse(r.stdout).map((m: { id: string }) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("insights defaults to story metrics", async () => {
    const r = await cli(["insights", "999"], [{ body: { data: [metric("views", 1500), metric("reach", 900)] } }]);
    expect(r.calls[0]!.searchParams.get("metric")).toBe("views,reach,replies,shares");
    expect(r.stdout).toMatch(/views\s+1,500/);
    expect(r.stdout).toMatch(/replies\s+-/);
  });

  it("insights --type reel --json", async () => {
    const r = await cli(["insights", "999", "--type", "reel", "--json"], [{ body: { data: [metric("saved", 5)] } }]);
    expect(JSON.parse(r.stdout)).toEqual({ views: null, reach: null, likes: null, comments: null, saves: 5, shares: null });
  });

  it("account-insights sends since/until in Unix seconds", async () => {
    const r = await cli(
      ["account-insights", "--since", "30d"],
      [{ body: { data: [{ name: "reach", period: "day", total_value: { value: 4200 } }] } }],
    );
    const q = r.calls[0]!.searchParams;
    expect(q.get("since")).toBe(String((NOW.getTime() - 30 * 86_400_000) / 1000));
    expect(q.get("until")).toBe(String(NOW.getTime() / 1000));
    expect(r.stdout).toMatch(/reach\s+4,200/);
  });

  it("account-insights defaults to 7d and takes --metrics", async () => {
    const r = await cli(["account-insights", "--metrics", "views, reach"], [{ body: { data: [] } }]);
    const q = r.calls[0]!.searchParams;
    expect(q.get("metric")).toBe("views,reach");
    expect(q.get("since")).toBe(String((NOW.getTime() - 7 * 86_400_000) / 1000));
  });

  it("account-insights takes a date", async () => {
    const r = await cli(["account-insights", "--since", "2026-11-01"], [{ body: { data: [] } }]);
    expect(r.calls[0]!.searchParams.get("since")).toBe(String(Date.UTC(2026, 10, 1) / 1000));
  });
});

describe("API errors", () => {
  it("exits 1 and explains an expired token", async () => {
    const r = await cli(
      ["account"],
      [{ status: 400, body: { error: { code: 190, message: `Invalid OAuth access token ${TOKEN}`, fbtrace_id: "T1" } } }],
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("expired or not valid");
    expect(r.stderr).toContain("fbtrace_id: T1");
    expect(r.stderr).toContain("[redacted]");
  });

  it("exits 1 on a rate limit", async () => {
    const r = await cli(["stories"], [{ status: 400, body: { error: { code: 17, message: "User request limit reached" } } }]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("rate-limited");
  });

  it("exits 1 on a network error and does not print the token", async () => {
    const r = await cli(["account"], [{ throws: new Error(`fetch failed for access_token=${TOKEN}`) }]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("failed");
  });
});

describe("helpers", () => {
  it("parseWhen reads relative and absolute times", () => {
    expect(parseWhen("24h", NOW).toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(parseWhen("7d", NOW).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(parseWhen("2026-10-01", NOW).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(() => parseWhen("yesterday", NOW)).toThrow();
  });

  it("table right-aligns number columns", () => {
    expect(table(["A", "N"], [["x", 1000], ["yy", 5]], [false, true])).toBe("A       N\nx   1,000\nyy      5");
  });
});
