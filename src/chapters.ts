/**
 * Build `data/chapters.json` — the chapter number -> title map.
 *
 * Chapter titles live on the chapter index pages, which the scraper parses but
 * previously only wrote to Postgres via `updateChapterTitle`. With the database
 * demoted to a side tool, that left the static pipeline with no chapter titles
 * at all: nothing to label a chapter page with, and nothing to put in the
 * accessible name of a `chapter 91` citation link.
 *
 * This reads the cached index HTML and writes the map as committed data, in the
 * same spirit as `data/parsed` — derived, deterministic, and diffable.
 *
 *   bun run chapters                # from data/html, fetching what is missing
 *   bun run chapters -- --no-fetch  # only what is already cached
 */
import { parseArgs } from "node:util";
import {
  CHAPTERS_PATH,
  HTML_DIR,
  MANIFEST_PATH,
  type ChapterRecord,
  type Manifest,
} from "./config";
import { fetchPage, pool } from "./fetcher";
import { parseChapterIndex } from "./parser";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { "no-fetch": { type: "boolean", default: false } },
  allowPositionals: true,
});
const noFetch = values["no-fetch"] ?? false;

const manifest: Manifest = await Bun.file(MANIFEST_PATH).json();
const jobs = manifest.volumes.flatMap((volume) =>
  volume.chapters.flatMap((chapter) =>
    chapter.files
      .filter((file) => file.isIndex)
      .map((file) => ({ file, number: chapter.number, volume: volume.number }))
  )
);

/**
 * Results keyed by chapter, each tagged with the index page it came from.
 *
 * Two chapters (`01-USCON`, `05-CONST`) have more than one index page. Writing
 * straight into a map would let the worker pool's completion order decide which
 * one wins, which is nondeterministic — and this file is committed and read as
 * a diff. They are reduced deterministically below instead.
 */
const results = new Map<string, { filename: string; record: ChapterRecord }[]>();
let fetched = 0;
let missing = 0;
let untitled = 0;

await pool(jobs, 8, async ({ file, number, volume }) => {
  const cached = Bun.file(`${HTML_DIR}/${file.filename}`);
  let html: string;
  if (await cached.exists()) html = await cached.text();
  else if (noFetch) {
    missing++;
    return;
  } else {
    try {
      html = await fetchPage(file.url);
      await Bun.write(`${HTML_DIR}/${file.filename}`, html);
      fetched++;
    } catch (error) {
      missing++;
      console.error(`  fetch failed ${file.filename}: ${(error as Error).message}`);
      return;
    }
  }

  const index = parseChapterIndex(html, file.filename, file.url, number);
  if (!index.title) untitled++;
  // Omitted rather than written as empty: the overwhelming majority of chapters
  // have neither, and this file is committed and read as a diff.
  const record: ChapterRecord = {
    title: index.title,
    volume,
    ...(index.notes ? { notes: index.notes } : {}),
    ...(index.annotations.length ? { annotations: index.annotations } : {}),
  };
  const existing = results.get(number);
  if (existing) existing.push({ filename: file.filename, record });
  else results.set(number, [{ filename: file.filename, record }]);
});

// Prefer a page that actually yielded a title, then the alphabetically first
// filename — a rule that does not depend on when a worker finished.
const titles = new Map<string, ChapterRecord>();
for (const [number, found] of results) {
  found.sort((a, b) => a.filename.localeCompare(b.filename));
  titles.set(number, (found.find((f) => f.record.title) ?? found[0]!).record);
}

// Sorted by chapter number so the file is stable across runs and diffs cleanly.
const sortKey = (n: string) =>
  (n.match(/\d+|[A-Za-z]+/g) ?? []).map((p) => (/\d/.test(p) ? p.padStart(6, "0") : p)).join("");
const sorted = [...titles].sort((a, b) => sortKey(a[0]).localeCompare(sortKey(b[0])));

const out: Record<string, ChapterRecord> = {};
for (const [number, value] of sorted) out[number] = value;

await Bun.write(CHAPTERS_PATH, `${JSON.stringify(out, null, 2)}\n`);

const withNotes = [...titles.values()].filter((c) => c.notes).length;
const withAnnotations = [...titles.values()].filter((c) => c.annotations).length;

console.log(`${titles.size} chapters -> ${CHAPTERS_PATH}`);
console.log(`${withNotes} with chapter notes, ${withAnnotations} with annotations`);
if (fetched) console.log(`fetched ${fetched} index page(s) missing from the cache`);
if (untitled) console.log(`${untitled} chapter(s) had no title on their index page`);
if (missing) console.log(`${missing} index page(s) unavailable`);
