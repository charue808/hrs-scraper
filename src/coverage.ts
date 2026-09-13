/**
 * Does the corpus have every section the chapter index pages say exists?
 *
 * Each chapter's index page lists its sections. `discover` never reads that
 * list — it crawls the directory, so a file the server has but the index does
 * not mention is found, and a section the index lists but no file exists for
 * is silently absent. This compares the two, in both directions, and is the
 * check to run after a re-scrape.
 *
 * What the gaps mean, from the first run (2026-09-12): files the index does
 * not list are almost all `REPEALED.` stubs — the index lists live sections and
 * the server keeps a one-line file the index omits. Listed sections with no
 * file are rows the index itself marks `Repealed`, plus chapter 626's own
 * numbering quirk (`626:1-626-1` for §626:1-100). Neither is a scrape gap.
 *
 *   bun run coverage
 *   bun run coverage -- --all      # every gap, not just the summary and samples
 */
import { parseArgs } from "node:util";
import { readdirSync } from "node:fs";
import { HTML_DIR, MANIFEST_PATH, PARSED_DIR, type Manifest, type ParsedSection } from "./config";
import { parseSectionListing } from "./parser";
import { pool } from "./fetcher";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { all: { type: "boolean", default: false } },
});

const manifest: Manifest = await Bun.file(MANIFEST_PATH).json();

// What the corpus has, per chapter. HRS only: the non-HRS documents number
// their sections differently and their index pages list them differently.
const have = new Map<string, Map<string, ParsedSection>>();
await pool(readdirSync(PARSED_DIR), 32, async (file) => {
  const s = (await Bun.file(`${PARSED_DIR}/${file}`).json()) as ParsedSection;
  if (s.docType !== "hrs") return;
  const map = have.get(s.chapterNumber) ?? new Map();
  map.set(s.sectionNumber.replace(/^§/, ""), s);
  have.set(s.chapterNumber, map);
});

let chapters = 0;
let noListing = 0;
let noIndex = 0;
let listed = 0;
let matched = 0;
const absent: { chapter: string; number: string; title: string }[] = [];
const unlisted: { chapter: string; number: string; repealed: boolean }[] = [];

for (const volume of manifest.volumes) {
  for (const chapter of volume.chapters) {
    if (!/^\d+[A-Z]*$/.test(chapter.number)) continue;
    const index = chapter.files.find((f) => f.isIndex);
    if (!index) {
      noIndex++;
      continue;
    }
    const cached = Bun.file(`${HTML_DIR}/${index.filename}`);
    if (!(await cached.exists())) {
      noIndex++;
      continue;
    }
    chapters++;
    const rows = parseSectionListing(await cached.text(), chapter.number);
    if (!rows.length) {
      // 292 chapters: every section repealed, the page is a repeal note.
      noListing++;
      continue;
    }
    const sections = have.get(chapter.number) ?? new Map<string, ParsedSection>();
    const seen = new Set<string>();
    for (const row of rows) {
      listed++;
      seen.add(row.number);
      if (sections.has(row.number)) matched++;
      else absent.push({ chapter: chapter.number, number: row.number, title: row.title });
    }
    for (const [number, s] of sections) {
      if (!seen.has(number)) unlisted.push({ chapter: chapter.number, number, repealed: s.isRepealed });
    }
  }
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(2)}%` : "—");
console.log(`${chapters} chapter index pages read; ${noListing} list no sections; ${noIndex} have no index page`);
console.log(`${listed} sections listed, ${matched} in the corpus (${pct(matched, listed)})`);
console.log();

const absentRepealed = absent.filter((a) => /repealed/i.test(a.title));
console.log(`${absent.length} listed but not in the corpus — ${absentRepealed.length} marked Repealed by the index itself`);
for (const a of values.all ? absent : absent.slice(0, 15)) {
  console.log(`  §${a.number.padEnd(14)} ${a.title.slice(0, 60)}`);
}
if (!values.all && absent.length > 15) console.log(`  … ${absent.length - 15} more (--all)`);
console.log();

const unlistedRepealed = unlisted.filter((u) => u.repealed);
const unlistedLive = unlisted.filter((u) => !u.repealed);
console.log(
  `${unlisted.length} in the corpus but not listed — ${unlistedRepealed.length} repealed stubs, ${unlistedLive.length} live`,
);
for (const u of values.all ? unlistedLive : unlistedLive.slice(0, 15)) {
  const s = have.get(u.chapter)!.get(u.number)!;
  console.log(`  §${u.number.padEnd(14)} ${(s.title || s.bodyText.slice(0, 60)).slice(0, 60)}`);
}
if (!values.all && unlistedLive.length > 15) console.log(`  … ${unlistedLive.length - 15} more (--all)`);
