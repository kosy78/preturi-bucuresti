import { expect, test } from 'vitest';
import { BlockedError, createFetcher } from './fetcher';

function fakeFetch(responses: (number | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(`body ${calls.length}`, { status: next ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function recordSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

test('waits the delay once between two calls', async () => {
  const { fetchImpl, calls } = fakeFetch([200, 200]);
  const { waits, sleep } = recordSleep();
  const get = createFetcher({ delayMs: 2500, fetchImpl, sleep });

  expect(await get('https://example.test/a')).toBe('body 1');
  expect(await get('https://example.test/b')).toBe('body 2');
  expect(waits).toEqual([2500]);
  expect(calls.map((c) => c.url)).toEqual(['https://example.test/a', 'https://example.test/b']);
});

test('retries a 500 after 10 s and returns the body of the 200', async () => {
  const { fetchImpl, calls } = fakeFetch([500, 200]);
  const { waits, sleep } = recordSleep();
  const get = createFetcher({ delayMs: 2500, fetchImpl, sleep });

  expect(await get('https://example.test/a')).toBe('body 2');
  expect(calls).toHaveLength(2);
  expect(waits).toEqual([10_000]);
});

test('retries network errors twice, waiting 10 s then 30 s, then gives up', async () => {
  const { fetchImpl, calls } = fakeFetch([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
  const { waits, sleep } = recordSleep();
  const get = createFetcher({ delayMs: 2500, fetchImpl, sleep });

  await expect(get('https://example.test/a')).rejects.toThrow('fetch failed');
  expect(calls).toHaveLength(3);
  expect(waits).toEqual([10_000, 30_000]);
});

test('a 403 throws BlockedError after exactly one request', async () => {
  const { fetchImpl, calls } = fakeFetch([403]);
  const { sleep } = recordSleep();
  const get = createFetcher({ delayMs: 2500, fetchImpl, sleep });

  await expect(get('https://example.test/a')).rejects.toBeInstanceOf(BlockedError);
  expect(calls).toHaveLength(1);
});

test('a 429 throws BlockedError without retry', async () => {
  const { fetchImpl, calls } = fakeFetch([429]);
  const { sleep } = recordSleep();
  const get = createFetcher({ delayMs: 2500, fetchImpl, sleep });

  await expect(get('https://example.test/a')).rejects.toMatchObject({ name: 'BlockedError', status: 429 });
  expect(calls).toHaveLength(1);
});

test('a 404 throws a plain error without retry', async () => {
  const { fetchImpl, calls } = fakeFetch([404]);
  const { sleep } = recordSleep();
  const get = createFetcher({ delayMs: 2500, fetchImpl, sleep });

  const error = await get('https://example.test/a').catch((e) => e);
  expect(error).not.toBeInstanceOf(BlockedError);
  expect(error).toMatchObject({ status: 404 });
  expect(calls).toHaveLength(1);
});

test('sends only the browser User-Agent header', async () => {
  const { fetchImpl, calls } = fakeFetch([200]);
  const get = createFetcher({ delayMs: 0, fetchImpl, sleep: async () => {} });

  await get('https://example.test/a');
  expect(calls[0].init?.headers).toEqual({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  });
});

test('each request has a 30 s timeout, and a timeout is retried like a network error', async () => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const { fetchImpl, calls } = fakeFetch([timeout as unknown as Error, 200]);
  const { waits, sleep } = recordSleep();
  const get = createFetcher({ delayMs: 2500, fetchImpl, sleep });

  expect(await get('https://example.test/a')).toBe('body 2');
  expect(waits).toEqual([10_000]);
  expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
});
