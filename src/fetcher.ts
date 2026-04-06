import puppeteer, { type Browser, type Page } from "puppeteer";
import {
  RATE_LIMIT_MS,
  MAX_CONCURRENT,
  MAX_RETRIES,
  RETRY_BACKOFF_MS,
} from "./config";

let browser: Browser | null = null;
let page: Page | null = null;
let lastRequestTime = 0;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  }
  return browser;
}

async function getPage(): Promise<Page> {
  if (!page || page.isClosed()) {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });
  }
  return page;
}

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await Bun.sleep(RATE_LIMIT_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

export async function fetchPage(url: string): Promise<string> {
  await rateLimit();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(`  Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms...`);
      await Bun.sleep(backoff);
    }

    try {
      const p = await getPage();
      const response = await p.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      if (!response) {
        throw new Error(`No response from: ${url}`);
      }

      const status = response.status();

      if (status === 200) {
        return await p.content();
      }

      if (status === 403) {
        // Cloudflare might show a challenge page - wait for it to resolve
        console.warn(`  Got 403, waiting for Cloudflare challenge...`);
        await Bun.sleep(5000);
        // Check if page content changed after challenge
        const bodyText = await p.evaluate(() => document.body?.innerText ?? "");
        if (!bodyText.includes("Attention Required")) {
          return await p.content();
        }
        throw new Error(`403 Forbidden (Cloudflare blocked): ${url}`);
      }

      if (status === 404) {
        throw new Error(`404 Not Found: ${url}`);
      }

      lastError = new Error(`HTTP ${status}: ${url}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes("404")) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error(`Failed after ${MAX_RETRIES} retries: ${url}`);
}

export async function fetchBatch(
  urls: string[],
  onProgress?: (completed: number, total: number, url: string) => void
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let completed = 0;

  // Puppeteer uses a single page, so process sequentially
  for (const url of urls) {
    try {
      const html = await fetchPage(url);
      results.set(url, html);
    } catch (err) {
      console.error(
        `  Failed: ${url} - ${err instanceof Error ? err.message : err}`
      );
    }
    completed++;
    onProgress?.(completed, urls.length, url);
  }

  return results;
}

/** Close the browser when done */
export async function closeBrowser(): Promise<void> {
  if (page && !page.isClosed()) {
    await page.close();
    page = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}
