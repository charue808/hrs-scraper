import {
  BASE_URL,
  FALLBACK_BASE_URL,
  HEADERS,
  MAX_RETRIES,
  RATE_LIMIT_MS,
  REQUEST_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
} from "./config";

/** Thrown for 404s so callers can distinguish "gone" from "try again". */
export class NotFoundError extends Error {}

// Request starts are spaced RATE_LIMIT_MS apart globally, so raising the
// worker count never raises the request rate past what this allows.
let nextSlot = 0;

async function takeSlot(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + RATE_LIMIT_MS;
  if (start > now) await Bun.sleep(start - now);
}

export async function fetchPage(url: string): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await Bun.sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt - 1));
    }
    await takeSlot();

    try {
      const response = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return await response.text();
      if (response.status === 404) throw new NotFoundError(`404 Not Found: ${url}`);

      lastError = new Error(`HTTP ${response.status}: ${url}`);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // The data host is a plain IIS mirror and occasionally drops requests. Fall
  // back to the Cloudflare-fronted www host, which needs a real browser.
  try {
    return await fetchViaBrowser(url.replace(BASE_URL, FALLBACK_BASE_URL));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${lastError?.message ?? url} (browser fallback: ${detail})`);
  }
}

// --- Puppeteer fallback (loaded lazily; unused on the happy path) ---

let browser: import("puppeteer").Browser | null = null;

async function fetchViaBrowser(url: string): Promise<string> {
  const puppeteer = (await import("puppeteer")).default;
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }

  const page = await browser.newPage();
  try {
    await page.setUserAgent(HEADERS["User-Agent"]!);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (!response) throw new Error(`No response from ${url}`);
    if (response.status() === 404) throw new NotFoundError(`404 Not Found: ${url}`);
    if (!response.ok()) throw new Error(`HTTP ${response.status()}: ${url}`);
    return await page.content();
  } finally {
    await page.close();
  }
}

/** Close the fallback browser, if one was ever launched. */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/** Run `fn` over `items` with at most `concurrency` in flight, preserving nothing. */
export async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
}
