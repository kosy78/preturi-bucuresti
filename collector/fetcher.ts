const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const RETRY_WAITS = [10_000, 30_000];
const TIMEOUT_MS = 30_000;

export class HttpError extends Error {
  constructor(public status: number) {
    super(`Storia answered ${status}`);
    this.name = 'HttpError';
  }
}

export class BlockedError extends HttpError {
  constructor(status: number) {
    super(status);
    this.name = 'BlockedError';
  }
}

export function createFetcher(opts: {
  delayMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): (url: string) => Promise<string> {
  const { delayMs, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = opts;
  let first = true;

  return async (url) => {
    if (!first) await sleep(delayMs);
    first = false;

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < RETRY_WAITS.length;
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        if (!canRetry) throw e;
        await sleep(RETRY_WAITS[attempt]);
        continue;
      }
      if (res.status === 403 || res.status === 429) throw new BlockedError(res.status);
      if (res.status >= 500 && canRetry) {
        await sleep(RETRY_WAITS[attempt]);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status);
      return res.text();
    }
  };
}
