import { parseArgs } from "util";
import {
  HTML_DIR,
  MANIFEST_PATH,
  MAX_CONCURRENT,
  PARSED_DIR,
  PROGRESS_PATH,
  serializeSection,
  type Manifest,
  type Progress,
  type SectionFile,
} from "./config";
import { closeBrowser, fetchPage, pool } from "./fetcher";
import { applyCorrections, loadCorrections } from "./corrections";
import { parseChapterIndex, parseSection } from "./parser";
import {
  closeDb,
  updateChapterTitle,
  upsertChapter,
  upsertSection,
  upsertVolume,
} from "./db";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    db: { type: "boolean", default: false },
    limit: { type: "string" },
    "save-html": { type: "boolean", default: false },
    concurrency: { type: "string" },
  },
  strict: true,
});

const useDb = values.db ?? false;
const limit = values.limit ? parseInt(values.limit, 10) : Infinity;
const saveHtml = values["save-html"] ?? false;
const concurrency = values.concurrency ? parseInt(values.concurrency, 10) : MAX_CONCURRENT;

const manifestFile = Bun.file(MANIFEST_PATH);
if (!(await manifestFile.exists())) {
  console.error(`Manifest not found at ${MANIFEST_PATH}. Run 'bun run discover' first.`);
  process.exit(1);
}
const corrections = await loadCorrections();
const manifest: Manifest = await manifestFile.json();

let progress: Progress;
const progressFile = Bun.file(PROGRESS_PATH);
if (await progressFile.exists()) {
  progress = await progressFile.json();
  console.log(`Resuming: ${progress.completedFiles.length} files already done`);
} else {
  progress = { lastUpdated: new Date().toISOString(), completedFiles: [], failedFiles: [] };
}
const completedSet = new Set(progress.completedFiles);

await Bun.$`mkdir -p ${PARSED_DIR}`.quiet();
if (saveHtml) await Bun.$`mkdir -p ${HTML_DIR}`.quiet();

interface Job {
  file: SectionFile;
  chapterNumber: string;
}

const jobs: Job[] = [];
for (const volume of manifest.volumes) {
  for (const chapter of volume.chapters) {
    for (const file of chapter.files) {
      if (!completedSet.has(file.url)) {
        jobs.push({ file, chapterNumber: chapter.number });
      }
    }
  }
}

const toProcess = jobs.slice(0, limit);
console.log(
  `\nProcessing ${toProcess.length} of ${jobs.length} remaining files (${manifest.totalFiles} total)`
);
console.log(`Concurrency: ${concurrency}`);
if (useDb) console.log("Database mode: ON");
if (saveHtml) console.log("Saving HTML: ON");

// Chapters must exist before sections can reference them.
if (useDb) {
  console.log("\nUpserting volumes and chapters...");
  for (const volume of manifest.volumes) {
    await upsertVolume(volume);
    for (const chapter of volume.chapters) {
      await upsertChapter(chapter);
    }
  }
  console.log("Done.");
}

let processed = 0;
let failed = 0;
let saving = false;
const saveInterval = 100;

// section_number is the upsert key, so two files resolving to the same number
// would silently overwrite each other. Surface that instead.
const seenNumbers = new Map<string, string>();

async function saveProgress(): Promise<void> {
  if (saving) return;
  saving = true;
  progress.lastUpdated = new Date().toISOString();
  await Bun.write(PROGRESS_PATH, JSON.stringify(progress, null, 2));
  saving = false;
}

await pool(toProcess, concurrency, async ({ file, chapterNumber }) => {
  try {
    const html = await fetchPage(file.url);

    if (saveHtml) {
      await Bun.write(`${HTML_DIR}/${file.filename}`, html);
    }

    if (file.isIndex) {
      // Index pages carry the chapter title rather than a section.
      const index = parseChapterIndex(html, file.filename, file.url, chapterNumber);
      if (useDb) await updateChapterTitle(index.chapterNumber, index.title);
    } else {
      const { section: parsed, warnings } = applyCorrections(
        parseSection(html, file.filename, file.url, chapterNumber),
        corrections
      );
      for (const warning of warnings) console.warn(`\n  ${warning}`);

      const previous = seenNumbers.get(parsed.sectionNumber);
      if (previous && previous !== parsed.filename) {
        console.warn(
          `\n  Duplicate section number ${parsed.sectionNumber}: ${previous} and ${parsed.filename}`
        );
      }
      seenNumbers.set(parsed.sectionNumber, parsed.filename);

      if (useDb) await upsertSection(parsed);

      const jsonPath = `${PARSED_DIR}/${file.filename.replace(/\.html?$/i, ".json")}`;
      await Bun.write(jsonPath, serializeSection(parsed));
    }

    progress.completedFiles.push(file.url);
    completedSet.add(file.url);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Error: ${file.filename} - ${errorMsg}`);
    progress.failedFiles.push({ url: file.url, error: errorMsg });
    failed++;
  }

  processed++;
  const pct = ((processed / toProcess.length) * 100).toFixed(1);
  process.stdout.write(`\r[${pct}%] (${processed}/${toProcess.length}) ${file.filename}`.padEnd(80));

  if (processed % saveInterval === 0) await saveProgress();
});

await saveProgress();

if (useDb) await closeDb();
await closeBrowser();

console.log(`\n\nDone! Processed: ${processed}, Failed: ${failed}`);
console.log(`Progress saved to ${PROGRESS_PATH}`);
