/**
 * Re-parse the corpus from locally cached HTML.
 *
 * This is what `--save-html` exists for. After a parser change, the corpus can
 * be rebuilt in seconds from `data/html/` instead of re-crawling 24,505 files
 * from a government server. Pages missing locally are fetched (and cached) so a
 * partial cache still yields a complete corpus.
 *
 *   bun run reparse                 # rebuild data/parsed from data/html
 *   bun run reparse -- --dry-run    # report what would change, write nothing
 *   bun run reparse -- --no-fetch   # skip pages with no cached HTML
 */
import { parseArgs } from "node:util";
import {
  HTML_DIR,
  MANIFEST_PATH,
  PARSED_DIR,
  serializeSection,
  type Manifest,
} from "./config";
import { applyCorrections, loadCorrections } from "./corrections";
import { fetchPage, pool } from "./fetcher";
import { parseSection } from "./parser";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    "no-fetch": { type: "boolean", default: false },
    concurrency: { type: "string" },
  },
  allowPositionals: true,
});

const dryRun = values["dry-run"] ?? false;
const noFetch = values["no-fetch"] ?? false;
const concurrency = values.concurrency ? parseInt(values.concurrency, 10) : 8;

const corrections = await loadCorrections();
const manifest: Manifest = await Bun.file(MANIFEST_PATH).json();
const jobs = manifest.volumes.flatMap((volume) =>
  volume.chapters.flatMap((chapter) =>
    chapter.files
      .filter((file) => !file.isIndex)
      .map((file) => ({ file, chapterNumber: chapter.number }))
  )
);

console.log(`${jobs.length} section files${dryRun ? " (dry run)" : ""}`);

let unchanged = 0;
let changed = 0;
let created = 0;
let fetched = 0;
let skipped = 0;
let failed = 0;
let anomalies = 0;
const correctionWarnings: string[] = [];
const seenNumbers = new Map<string, string>();
const duplicates: string[] = [];
const samples: string[] = [];

await pool(jobs, concurrency, async ({ file, chapterNumber }) => {
  const htmlPath = `${HTML_DIR}/${file.filename}`;
  let html: string;

  const cached = Bun.file(htmlPath);
  if (await cached.exists()) {
    html = await cached.text();
  } else if (noFetch) {
    skipped++;
    return;
  } else {
    try {
      html = await fetchPage(file.url);
      if (!dryRun) await Bun.write(htmlPath, html);
      fetched++;
    } catch (error) {
      failed++;
      console.error(`\n  fetch failed ${file.filename}: ${(error as Error).message}`);
      return;
    }
  }

  let parsed;
  try {
    parsed = parseSection(html, file.filename, file.url, chapterNumber);
  } catch (error) {
    failed++;
    console.error(`\n  parse failed ${file.filename}: ${(error as Error).message}`);
    return;
  }

  const applied = applyCorrections(parsed, corrections);
  parsed = applied.section;
  if (parsed.sourceAnomalies.length) anomalies++;
  for (const warning of applied.warnings) correctionWarnings.push(warning);

  const previous = seenNumbers.get(parsed.sectionNumber);
  if (previous && previous !== parsed.filename) {
    duplicates.push(`${parsed.sectionNumber}: ${previous} and ${parsed.filename}`);
  }
  seenNumbers.set(parsed.sectionNumber, parsed.filename);

  const jsonPath = `${PARSED_DIR}/${file.filename.replace(/\.html?$/i, ".json")}`;
  const next = serializeSection(parsed);
  const target = Bun.file(jsonPath);
  const before = (await target.exists()) ? await target.text() : null;

  if (before === null) {
    created++;
  } else if (before === next) {
    unchanged++;
    return;
  } else {
    changed++;
    if (samples.length < 10) {
      const was = JSON.parse(before);
      if (was.sectionNumber !== parsed.sectionNumber || was.title !== parsed.title) {
        samples.push(
          `${file.filename}\n     was ${was.sectionNumber} ${JSON.stringify(was.title)}` +
            `\n     now ${parsed.sectionNumber} ${JSON.stringify(parsed.title)}`
        );
      }
    }
  }

  if (!dryRun) await Bun.write(jsonPath, next);
});

console.log(`\nunchanged ${unchanged}  changed ${changed}  created ${created}`);
if (fetched) console.log(`fetched ${fetched} page(s) missing from the local cache`);
if (skipped) console.log(`skipped ${skipped} page(s) with no cached HTML (--no-fetch)`);
if (failed) console.log(`failed ${failed}`);
if (anomalies) console.log(`${anomalies} section(s) carry a recorded source anomaly`);
for (const warning of correctionWarnings) console.warn(`\n  ${warning}`);

if (samples.length) {
  console.log("\nsample number/title changes:");
  for (const sample of samples) console.log(`   ${sample}`);
}

console.log(
  duplicates.length
    ? `\nDUPLICATE section numbers: ${duplicates.length}\n   ${duplicates.join("\n   ")}`
    : "\nNo duplicate section numbers."
);
