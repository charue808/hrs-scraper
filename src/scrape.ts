import { parseArgs } from "util";
import {
  MANIFEST_PATH,
  PROGRESS_PATH,
  PARSED_DIR,
  HTML_DIR,
  DATA_DIR,
  type Manifest,
  type Progress,
  type SectionFile,
} from "./config";
import { fetchPage, closeBrowser } from "./fetcher";
import { parseSection } from "./parser";
import { upsertVolume, upsertChapter, upsertSection, closeDb } from "./db";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    db: { type: "boolean", default: false },
    limit: { type: "string" },
    "save-html": { type: "boolean", default: false },
  },
  strict: true,
});

const useDb = values.db ?? false;
const limit = values.limit ? parseInt(values.limit, 10) : Infinity;
const saveHtml = values["save-html"] ?? false;

// Load manifest
const manifestFile = Bun.file(MANIFEST_PATH);
if (!(await manifestFile.exists())) {
  console.error(
    `Manifest not found at ${MANIFEST_PATH}. Run 'bun run discover' first.`
  );
  process.exit(1);
}
const manifest: Manifest = await manifestFile.json();

// Load or create progress
let progress: Progress;
const progressFile = Bun.file(PROGRESS_PATH);
if (await progressFile.exists()) {
  progress = await progressFile.json();
  console.log(`Resuming: ${progress.completedFiles.length} files already done`);
} else {
  progress = { lastUpdated: new Date().toISOString(), completedFiles: [], failedFiles: [] };
}
const completedSet = new Set(progress.completedFiles);

// Ensure output directories
await Bun.$`mkdir -p ${PARSED_DIR}`.quiet();
if (saveHtml) {
  await Bun.$`mkdir -p ${HTML_DIR}`.quiet();
}

// Build flat list of files to process
const allFiles: { file: SectionFile; volumeIdx: number; chapterIdx: number }[] = [];
for (let vi = 0; vi < manifest.volumes.length; vi++) {
  const volume = manifest.volumes[vi]!;
  for (let ci = 0; ci < volume.chapters.length; ci++) {
    const chapter = volume.chapters[ci]!;
    for (const file of chapter.files) {
      if (!completedSet.has(file.url)) {
        allFiles.push({ file, volumeIdx: vi, chapterIdx: ci });
      }
    }
  }
}

const toProcess = allFiles.slice(0, limit);
console.log(
  `\nProcessing ${toProcess.length} of ${allFiles.length} remaining files (${manifest.totalFiles} total)`
);
if (useDb) console.log("Database mode: ON");
if (saveHtml) console.log("Saving HTML: ON");

// If using DB, upsert volumes and chapters first
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
const saveInterval = 100;

for (const { file } of toProcess) {
  const pct = ((processed / toProcess.length) * 100).toFixed(1);
  process.stdout.write(
    `\r[${pct}%] (${processed}/${toProcess.length}) ${file.filename}`.padEnd(80)
  );

  try {
    const html = await fetchPage(file.url);

    // Save raw HTML if requested
    if (saveHtml) {
      await Bun.write(`${HTML_DIR}/${file.filename}`, html);
    }

    // Skip index pages for parsing (they don't contain sections)
    if (!file.isIndex) {
      const parsed = parseSection(html, file.filename, file.url);

      if (useDb) {
        await upsertSection(parsed);
      }

      // Always save JSON locally
      const jsonPath = `${PARSED_DIR}/${file.filename.replace(/\.htm$/i, ".json")}`;
      await Bun.write(jsonPath, JSON.stringify(parsed, null, 2));
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

  // Save progress periodically
  if (processed % saveInterval === 0) {
    progress.lastUpdated = new Date().toISOString();
    await Bun.write(PROGRESS_PATH, JSON.stringify(progress, null, 2));
  }
}

// Final progress save
progress.lastUpdated = new Date().toISOString();
await Bun.write(PROGRESS_PATH, JSON.stringify(progress, null, 2));

if (useDb) {
  await closeDb();
}
await closeBrowser();

console.log(`\n\nDone! Processed: ${processed}, Failed: ${failed}`);
console.log(`Progress saved to ${PROGRESS_PATH}`);
