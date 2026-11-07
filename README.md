# @storylinkpro/instagram-stories-api

A typed client and CLI for the Instagram Graph API. It reads an account's Stories, posts and reels, and their insights. It has no dependencies. It needs Node 20+ or another runtime with `fetch`.

Use it in a script, a cron job or your own dashboard.

> Unofficial. Meta did not make this package and does not support it. It calls Meta's public Graph API at `graph.facebook.com`.

## Install

```sh
npm install @storylinkpro/instagram-stories-api
```

## Quick start

```ts
import { createClient } from "@storylinkpro/instagram-stories-api";

const ig = createClient({
  accessToken: process.env.INSTAGRAM_ACCESS_TOKEN!,
  igUserId: process.env.INSTAGRAM_USER_ID, // the Instagram professional account id
});

const { username, followers_count } = await ig.account();

for (const story of await ig.stories()) {
  const { views, reach, replies } = await ig.storyInsights(story.id);
  console.log(story.id, views, reach, replies);
}
```

## Command line

You can query the API from a terminal without an install:

```sh
npx @storylinkpro/instagram-stories-api stories
```

After `npm install -g @storylinkpro/instagram-stories-api`, the command is `instagram-stories-api`.

```text
ID                 TYPE   POSTED (UTC)      PERMALINK
18012345678901234  IMAGE  2026-11-07 08:30  https://www.instagram.com/stories/example/18012345678901234
18012345678905678  VIDEO  2026-11-07 09:10  https://www.instagram.com/stories/example/18012345678905678
```

| Command | Prints |
|---|---|
| `account` | The account's id, username, name, followers, follows and media count. |
| `stories` | The account's current stories. Instagram keeps a story for 24 hours. |
| `media [--limit n]` | The most recent posts and reels. The default is 10. |
| `insights <media-id> [--type story\|post\|reel]` | Insights for one media. The default type is `story`. |
| `account-insights [--since 7d]` | Account totals for a window: views, reach, likes, comments, shares and replies. |

Options:

- `--token`: the access token. The default is `INSTAGRAM_ACCESS_TOKEN`.
- `--account`, `-a`: the Instagram account id. The default is `INSTAGRAM_USER_ID`.
- `--since`, `-s` and `--until`, `-u`: `24h`, `7d`, `30d` or a date such as `2026-10-01`. Meta rejects a window of 30 days or more.
- `--metrics`: account metrics, separated by commas.
- `--api-version`: the Graph API version. The default is `v25.0`.
- `--json`: print JSON for a script or another tool.
- `--help`, `-h`: help for the CLI or for one command.

The CLI never prints the token. The exit code is 0 on success, 1 when Meta returns an error, and 2 for a usage error.

## Methods

| Method | Returns |
|---|---|
| `account()` | `{ id, username, name, followers_count, follows_count, media_count, profile_picture_url }`. |
| `stories()` | The current stories as `Media[]`. It reads every page. |
| `media({ limit?, since?, until?, after? })` | One page of posts and reels: `{ data, after, hasNext }`. Pass `after` to get the next page. |
| `iterateMedia({ ..., max? })` | An async iterator over all posts and reels. It follows `paging.next`. `max` stops it early. |
| `storyInsights(mediaId)` | `{ views, reach, replies, shares }`. |
| `postInsights(mediaId)` | `{ views, reach, likes, comments, saves, shares }`. |
| `reelInsights(mediaId)` | `{ views, reach, likes, comments, saves, shares }`. |
| `accountInsights({ metrics?, since?, until?, period?, metricType?, breakdown?, timeframe? })` | One `{ name, period, total, values, breakdowns }` per metric. |

A `Media` has `id`, `media_type`, `media_product_type`, `timestamp`, `permalink`, `caption`, `media_url` and `thumbnail_url`. A field that Meta leaves out is `null`.

An insight that Meta does not return is `null`, not `0`. Meta withholds some story numbers when fewer than 5 people saw the story. Meta calls saves `saved`. The client returns them as `saves`.

`accountInsights()` sends `period=day` and `metric_type=total_value` by default. For follower demographics, pass `metrics: ["follower_demographics"]`, `period: "lifetime"`, `timeframe: "this_month"` and a `breakdown` such as `"country"` or `"age,gender"`.

`since` and `until` take a `Date`, epoch milliseconds or a date string. The client sends Unix seconds.

Methods that read an account take `igUserId` to use another account than the client's. Every method takes `signal` (an `AbortSignal`).

`createClient()` also takes `apiVersion` (default `v25.0`), `fetch` (for tests or another runtime) and `timeoutMs` (default 30000).

## Errors

A failed call throws `InstagramApiError`. It has `status`, and Meta's `code`, `subcode`, `type`, `fbtraceId` and `message`. It also has these flags:

- `isAuthError`: code 190, or subcode 458, 460, 463 or 467. The token expired, someone revoked it, or it is not valid. Get a new token.
- `isRateLimit`: code 4, 17, 32, 613, 80001 or 80002. Meta throttled the app or the account. Wait before you try again.

A network error or a timeout has `status` 0. The message never contains the access token.

```ts
import { InstagramApiError } from "@storylinkpro/instagram-stories-api";

try {
  await ig.stories();
} catch (e) {
  if (e instanceof InstagramApiError && e.isAuthError) console.error("Get a new token");
  else throw e;
}
```

### Rate-limit usage

Meta sends usage headers on each response. `ig.lastUsage` holds the most recent ones, and `error.usage` holds the ones of a failed call:

```ts
ig.lastUsage?.app; // { call_count, total_time, total_cputime } from x-app-usage, in percent
ig.lastUsage?.businessUseCase; // from x-business-use-case-usage, per business object id
```

The client does not retry. You decide when to call again.

## Get a token

This version uses the Instagram API with Facebook Login. You need:

1. An Instagram professional account (Business or Creator) that is linked to a Facebook Page.
2. A Meta app with the `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement` permissions.
3. A Facebook User or Page access token. For a quick test, get one in the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).

To find the Instagram account id, call `GET /me/accounts?fields=instagram_business_account` with the token. See Meta's [Instagram Platform docs](https://developers.facebook.com/docs/instagram-platform) for the full steps.

Keep the token on the server. Do not send it to the browser.

## Made by Storylink

Made by [Storylink](https://storylink.pro). Storylink schedules Instagram Stories, posts and reels.

## License

MIT
