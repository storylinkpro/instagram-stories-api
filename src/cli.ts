import { parseArgs } from "node:util";
import { createClient, type InstagramClient, type Media } from "./client.js";
import { InstagramApiError, redact } from "./errors.js";

export const EXIT_OK = 0;
export const EXIT_API_ERROR = 1;
export const EXIT_USAGE = 2;

export type CliIo = {
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetch?: typeof fetch;
  now?: () => Date;
};

class UsageError extends Error {}

const COMMANDS = ["account", "stories", "media", "insights", "account-insights"] as const;
type Command = (typeof COMMANDS)[number];

const GLOBAL_HELP = `Usage: instagram-stories-api <command> [options]

Read Instagram Stories, media and insights from the Instagram Graph API.

Commands:
  account                     Show the account's profile and counts.
  stories                     List the account's current stories (last 24 hours).
  media [--limit n]           List recent posts and reels. Default 10.
  insights <media-id>         Show insights for one media. Add --type story|post|reel.
  account-insights            Show account insights. Add --since 7d|30d|YYYY-MM-DD.

Options:
  --token <token>             Access token. Default: $INSTAGRAM_ACCESS_TOKEN.
  --account, -a <id>          Instagram account id. Default: $INSTAGRAM_USER_ID.
  --api-version <v>           Graph API version. Default: v25.0.
  --json                      Print JSON.
  --help, -h                  Show help. "<command> --help" shows help for one command.

Exit codes: 0 success, 1 API error, 2 usage error.
Unofficial. Not made or supported by Meta. Made by Storylink: https://storylink.pro`;

const COMMAND_HELP: Record<Command, string> = {
  account: `Usage: instagram-stories-api account [--account <id>] [--json]

Show the account's id, username, name, followers, follows and media count.`,
  stories: `Usage: instagram-stories-api stories [--account <id>] [--json]

List the account's current stories. Instagram keeps a story for 24 hours.`,
  media: `Usage: instagram-stories-api media [--limit n] [--account <id>] [--json]

List the account's most recent posts and reels, newest first.

  --limit, -n <n>   The number of items. Default 10.`,
  insights: `Usage: instagram-stories-api insights <media-id> [--type story|post|reel] [--json]

Show insights for one media.

  --type, -t <type>   story (default): views, reach, replies, shares.
                      post or reel: views, reach, likes, comments, saves, shares.`,
  "account-insights": `Usage: instagram-stories-api account-insights [--since 7d] [--until <date>] [--metrics a,b] [--json]

Show account totals for a time window.

  --since, -s <when>   24h, 7d, 30d or a date such as 2026-10-01. Default 7d.
  --until, -u <when>   The end of the window. Default now.
  --metrics <list>     Comma-separated metrics. Default views,reach,likes,comments,shares,replies.

Meta rejects a window of 30 days or more.`,
};

/** Parse `7d`, `24h` or a date string into a Date. */
export function parseWhen(value: string, now: Date): Date {
  const rel = /^(\d+)([dh])$/.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const ms = rel[2] === "d" ? n * 86_400_000 : n * 3_600_000;
    return new Date(now.getTime() - ms);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return new Date(t);
  }
  throw new UsageError(`Not a valid time: "${value}". Use 24h, 7d, 30d or YYYY-MM-DD.`);
}

const fmtNum = (n: number | null | undefined): string =>
  typeof n === "number" ? n.toLocaleString("en-US") : "-";

/** Render rows as a plain text table. Number columns are right-aligned. */
export function table(headers: string[], rows: Array<Array<string | number | null>>, numeric: boolean[] = []): string {
  const cells = rows.map((r) => r.map((c) => (typeof c === "number" ? fmtNum(c) : c ?? "-")));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => (numeric[i] ? c.padStart(widths[i]!) : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [line(headers), ...cells.map(line)].join("\n");
}

function shortTime(iso: string | null): string {
  return iso ? iso.replace("T", " ").replace(/:\d{2}(\+0000|Z)$/, "").slice(0, 16) : "-";
}

function oneLine(text: string | null, max = 40): string {
  if (!text) return "-";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  let token: string | undefined;
  const out = (s: string) => io.stdout(redact(s, token) + "\n");
  const err = (s: string) => io.stderr(redact(s, token) + "\n");

  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {
          token: { type: "string" },
          account: { type: "string", short: "a" },
          "api-version": { type: "string" },
          json: { type: "boolean" },
          help: { type: "boolean", short: "h" },
          limit: { type: "string", short: "n" },
          type: { type: "string", short: "t" },
          since: { type: "string", short: "s" },
          until: { type: "string", short: "u" },
          metrics: { type: "string" },
        },
      });
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message : String(e));
    }
    const { values, positionals } = parsed;
    token = values.token ?? io.env.INSTAGRAM_ACCESS_TOKEN;
    const [cmdName, ...rest] = positionals;

    if (!cmdName) {
      (values.help ? out : err)(GLOBAL_HELP);
      return values.help ? EXIT_OK : EXIT_USAGE;
    }
    if (!(COMMANDS as readonly string[]).includes(cmdName)) {
      throw new UsageError(`Unknown command "${cmdName}". Run "instagram-stories-api --help".`);
    }
    const cmd = cmdName as Command;
    if (values.help) {
      out(COMMAND_HELP[cmd]);
      return EXIT_OK;
    }
    const maxPositionals = cmd === "insights" ? 1 : 0;
    if (rest.length > maxPositionals) throw new UsageError(`Unexpected argument "${rest[maxPositionals]}".`);

    if (!token) throw new UsageError("No access token. Pass --token or set INSTAGRAM_ACCESS_TOKEN.");
    const igUserId = values.account ?? io.env.INSTAGRAM_USER_ID;
    if (cmd !== "insights" && !igUserId) {
      throw new UsageError("No account id. Pass --account or set INSTAGRAM_USER_ID.");
    }

    let client: InstagramClient;
    try {
      client = createClient({
        accessToken: token,
        igUserId,
        apiVersion: values["api-version"],
        fetch: io.fetch,
      });
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message : String(e));
    }
    const json = values.json === true;
    const print = (data: unknown, text: () => string) => out(json ? JSON.stringify(data, null, 2) : text());
    const now = io.now?.() ?? new Date();

    switch (cmd) {
      case "account": {
        const a = await client.account();
        print(a, () =>
          table(
            ["FIELD", "VALUE"],
            [
              ["id", a.id],
              ["username", a.username],
              ["name", a.name],
              ["followers", fmtNum(a.followers_count)],
              ["follows", fmtNum(a.follows_count)],
              ["media", fmtNum(a.media_count)],
            ],
          ),
        );
        return EXIT_OK;
      }
      case "stories": {
        const s = await client.stories();
        print(s, () =>
          s.length === 0
            ? "No current stories."
            : table(
                ["ID", "TYPE", "POSTED (UTC)", "PERMALINK"],
                s.map((m) => [m.id, m.media_type, shortTime(m.timestamp), m.permalink]),
              ),
        );
        return EXIT_OK;
      }
      case "media": {
        const limit = values.limit === undefined ? 10 : Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new UsageError("--limit must be a positive whole number.");
        const items: Media[] = [];
        for await (const m of client.iterateMedia({ max: limit, limit: Math.min(limit, 50) })) items.push(m);
        print(items, () =>
          items.length === 0
            ? "No media."
            : table(
                ["ID", "KIND", "POSTED (UTC)", "CAPTION"],
                items.map((m) => [m.id, m.media_product_type ?? m.media_type, shortTime(m.timestamp), oneLine(m.caption)]),
              ),
        );
        return EXIT_OK;
      }
      case "insights": {
        const mediaId = rest[0];
        if (!mediaId) throw new UsageError("Missing <media-id>. Usage: instagram-stories-api insights <media-id>");
        if (!/^[A-Za-z0-9_]+$/.test(mediaId)) throw new UsageError("<media-id> must contain only letters, digits or \"_\".");
        const type = values.type ?? "story";
        let result: Record<string, number | null>;
        if (type === "story") result = await client.storyInsights(mediaId);
        else if (type === "post") result = await client.postInsights(mediaId);
        else if (type === "reel") result = await client.reelInsights(mediaId);
        else throw new UsageError(`--type must be story, post or reel, not "${type}".`);
        print(result, () =>
          table(["METRIC", "VALUE"], Object.entries(result).map(([k, v]) => [k, v]), [false, true]),
        );
        return EXIT_OK;
      }
      case "account-insights": {
        const since = parseWhen(values.since ?? "7d", now);
        const until = values.until ? parseWhen(values.until, now) : now;
        if (since >= until) throw new UsageError("--since must be before --until.");
        const metrics = values.metrics
          ?.split(",")
          .map((m) => m.trim())
          .filter(Boolean);
        if (metrics && metrics.length === 0) throw new UsageError("--metrics must name at least one metric.");
        const rows = await client.accountInsights({ since, until, metrics });
        print(rows, () =>
          table(
            ["METRIC", "TOTAL"],
            rows.map((r) => [r.name, r.total]),
            [false, true],
          ),
        );
        return EXIT_OK;
      }
    }
  } catch (e) {
    if (e instanceof UsageError || e instanceof TypeError) {
      err(`Error: ${e.message}`);
      return EXIT_USAGE;
    }
    if (e instanceof InstagramApiError) {
      err(`Error: ${e.message}`);
      if (e.isAuthError) err("The access token is expired or not valid. Get a new token.");
      else if (e.isRateLimit) err("Meta rate-limited this app or account. Wait and try again.");
      if (e.fbtraceId) err(`fbtrace_id: ${e.fbtraceId}`);
      return EXIT_API_ERROR;
    }
    err(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT_API_ERROR;
  }
}
