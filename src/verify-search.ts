/**
 * End-to-end check of the search page, in a real browser.
 *
 * Search is the one part of this site that cannot be verified by reading the
 * built output: it depends on Pagefind's WASM, its UI, and `search-client.js`
 * all agreeing at runtime. Every defect in it so far was found this way and
 * would have been invisible to a unit test — that searching `26-34` never
 * returned §26-34, and that `cannabus` returned 878 confident results.
 *
 * Kept out of `bun test` on purpose: it needs a Chrome download and a running
 * server, so a fresh clone would fail for reasons unrelated to the code.
 *
 *   bun run serve &          # or in another terminal
 *   bun run verify-search
 *   bun run verify-search -- --url http://localhost:8080
 */
import { parseArgs } from "node:util";
import { readdirSync } from "node:fs";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { url: { type: "string" } },
  allowPositionals: true,
});
const BASE = values.url ?? "http://localhost:3000";

/** Puppeteer's bundled Chrome, whichever version was installed. */
function findChrome(): string | undefined {
  const root = `${process.env.HOME}/.cache/puppeteer/chrome`;
  try {
    for (const dir of readdirSync(root).sort().reverse()) {
      const path = `${root}/${dir}/chrome-linux64/chrome`;
      if (readdirSync(`${root}/${dir}`).length) return path;
    }
  } catch {
    // No cache directory: fall through to puppeteer's own resolution.
  }
  return undefined;
}

if (!(await fetch(`${BASE}/search`).then((r) => r.ok).catch(() => false))) {
  console.error(`no server at ${BASE} — run \`bun run serve\` first`);
  process.exit(1);
}

const puppeteer = (await import("puppeteer")).default;
const browser = await puppeteer.launch({
  args: ["--no-sandbox"],
  executablePath: findChrome(),
});
const page = await browser.newPage();

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/search`, { waitUntil: "networkidle2" });
// The vocabulary is fetched after load; suggestions are silent until it lands.
await page.waitForFunction(
  () => document.querySelector(".pagefind-ui__search-input") !== null,
  { timeout: 15000 }
);
await Bun.sleep(1500);

interface Check {
  query: string;
  /** Expected href of the "go straight to" link, if one should appear. */
  jump?: string;
  /** Expected suggested spelling, if one should appear. */
  suggest?: string;
  /** True when the query is fine and neither notice should show. */
  clean?: boolean;
}

const checks: Check[] = [
  // A section number is an address. Pagefind cannot rank these; the jump can.
  { query: "26-34", jump: "/hrs/26-34/" },
  { query: "1-1", jump: "/hrs/1-1/" },
  { query: "431:10C-301", jump: "/hrs/431-10C-301/" },
  { query: "§26-34", jump: "/hrs/26-34/" },
  { query: "9999-1", clean: true }, // shaped like one, but does not exist
  // Typos. Pagefind answers all of these with confident nonsense.
  { query: "marijauna", suggest: "marijuana" }, // transposition
  { query: "marjuana", suggest: "marijuana" }, // deletion
  { query: "marihuana", suggest: "marijuana" }, // the older statutory spelling
  { query: "cannabus", suggest: "cannabis" },
  { query: "condominum", suggest: "condominium" },
  { query: "riparain", suggest: "riparian" },
  // Correct queries must stay quiet.
  { query: "marijuana", clean: true },
  { query: "quiet title action", clean: true },
  { query: "mari", clean: true }, // still being typed
];

let failures = 0;

for (const check of checks) {
  await page.evaluate(() => {
    const input = document.querySelector(".pagefind-ui__search-input") as HTMLInputElement;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type(".pagefind-ui__search-input", check.query);
  await Bun.sleep(900);

  const state = await page.evaluate(() => {
    const shown = (id: string) => {
      const el = document.getElementById(id);
      return el && !el.hidden ? el : null;
    };
    const jump = shown("jump");
    const spelling = shown("spelling");
    return {
      jump: jump?.querySelector("a")?.getAttribute("href") ?? null,
      suggest: spelling?.querySelector("a")?.textContent?.trim() ?? null,
      notice: spelling?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    };
  });

  const problems: string[] = [];
  if (check.jump && state.jump !== check.jump) problems.push(`jump ${state.jump} != ${check.jump}`);
  if (check.suggest && state.suggest !== check.suggest)
    problems.push(`suggest ${state.suggest} != ${check.suggest}`);
  if (check.clean && (state.jump || state.notice))
    problems.push(`expected no notice, got ${state.jump ?? state.notice}`);

  if (problems.length) {
    failures++;
    console.log(`FAIL  ${check.query.padEnd(20)} ${problems.join("; ")}`);
  } else {
    const got = state.jump ?? state.suggest ?? "quiet";
    console.log(`ok    ${check.query.padEnd(20)} ${got}`);
  }
}

// Suggestions run on every keystroke over 17,223 words; a slow one is a janky
// search box.
const millis = await page.evaluate(() => {
  const input = document.querySelector(".pagefind-ui__search-input") as HTMLInputElement;
  const started = performance.now();
  input.value = "condominum";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return performance.now() - started;
});
console.log(`\nsuggestion dispatch: ${millis.toFixed(1)}ms`);

if (errors.length) {
  failures++;
  console.log("page errors:", errors.slice(0, 3));
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall ${checks.length} checks passed`);
process.exit(failures ? 1 : 0);
