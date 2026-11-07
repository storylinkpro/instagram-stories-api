export const TOKEN = "EAAtestTOKEN1234567890secret";

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; throws?: Error };

/** A fake `fetch` that answers from a queue and records each URL. */
export function mockFetch(...replies: Reply[]) {
  const calls: URL[] = [];
  const queue = [...replies];
  const fn = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    const r = queue.shift();
    if (!r) throw new Error(`Unexpected fetch: ${url.pathname}`);
    if (r.throws) throw r.throws;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...r.headers },
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export const metric = (name: string, value: number) => ({ name, period: "lifetime", values: [{ value }] });
