import * as cheerio from "cheerio";
import {
  BASE_URL,
  DATA_DIR,
  MANIFEST_PATH,
  MAX_CONCURRENT,
  type Chapter,
  type Manifest,
  type SectionFile,
  type Volume,
} from "./config";
import { fetchPage, pool } from "./fetcher";
import { isIndexFilename, normalizeChapterNumber } from "./parser";

interface Entry {
  name: string;
  url: string;
  isDir: boolean;
}

/**
 * Read one IIS directory listing.
 *
 * The listings link with absolute paths (`<A HREF="/hrscurrent/Vol01.../">`),
 * so hrefs are resolved against the page URL and then kept only when they land
 * directly inside it. That drops the "[To Parent Directory]" link and any
 * deeper path without needing to special-case either.
 */
async function listDirectory(pageUrl: string): Promise<Entry[]> {
  const $ = cheerio.load(await fetchPage(pageUrl));
  const entries: Entry[] = [];

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const resolved = new URL(href, pageUrl).href;
    if (!resolved.startsWith(pageUrl) || resolved === pageUrl) return;

    const relative = decodeURIComponent(resolved.slice(pageUrl.length));
    const isDir = relative.endsWith("/");
    const name = isDir ? relative.slice(0, -1) : relative;
    if (!name || name.includes("/")) return; // not a direct child

    entries.push({ name, url: resolved, isDir });
  });

  return entries;
}

async function discoverVolumes(): Promise<Volume[]> {
  console.log("Discovering volumes...");
  const volumes: Volume[] = [];

  for (const entry of await listDirectory(BASE_URL)) {
    const match = entry.name.match(/^Vol(\d+)_Ch(.+)$/);
    if (!entry.isDir || !match) continue;
    volumes.push({
      number: parseInt(match[1]!, 10),
      dirName: entry.name,
      chapterRange: match[2]!,
      chapters: [],
    });
  }

  volumes.sort((a, b) => a.number - b.number);
  console.log(`  Found ${volumes.length} volumes`);
  return volumes;
}

/**
 * Every subdirectory of a volume is a chapter. Volume 1 also holds the
 * non-HRS documents (`01-USCON`, `05-CONST`, `06-HHCA`, ...), which are
 * kept — they are part of the published corpus.
 */
async function discoverChapters(volume: Volume): Promise<Chapter[]> {
  const entries = await listDirectory(`${BASE_URL}${volume.dirName}/`);
  const chapters = entries
    .filter((entry) => entry.isDir)
    .map((entry) => ({
      number: normalizeChapterNumber(entry.name),
      dirName: entry.name,
      volumeNumber: volume.number,
      title: "",
      files: [] as SectionFile[],
    }));

  chapters.sort((a, b) => a.dirName.localeCompare(b.dirName));
  return chapters;
}

async function discoverFiles(volume: Volume, chapter: Chapter): Promise<SectionFile[]> {
  const chapterUrl = `${BASE_URL}${volume.dirName}/${chapter.dirName}/`;
  const files = (await listDirectory(chapterUrl))
    .filter((entry) => !entry.isDir && /\.html?$/i.test(entry.name))
    .map((entry) => ({
      filename: entry.name,
      url: entry.url,
      isIndex: isIndexFilename(entry.name),
    }));

  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return files;
}

async function main() {
  console.log(`HRS Discovery - Building manifest from ${BASE_URL}\n`);
  await Bun.$`mkdir -p ${DATA_DIR}`.quiet();

  const volumes = await discoverVolumes();

  for (const volume of volumes) {
    volume.chapters = await discoverChapters(volume);
    console.log(`Volume ${volume.number} (${volume.dirName}): ${volume.chapters.length} chapters`);
  }

  const allChapters = volumes.flatMap((volume) =>
    volume.chapters.map((chapter) => ({ volume, chapter }))
  );

  console.log(`\nListing ${allChapters.length} chapter directories...`);
  let done = 0;
  await pool(allChapters, MAX_CONCURRENT, async ({ volume, chapter }) => {
    chapter.files = await discoverFiles(volume, chapter);
    done++;
    process.stdout.write(`\r  ${done}/${allChapters.length} chapters listed`.padEnd(60));
  });

  const totalFiles = volumes.reduce(
    (sum, volume) => sum + volume.chapters.reduce((n, c) => n + c.files.length, 0),
    0
  );

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    volumes,
    totalFiles,
  };

  await Bun.write(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\n\nManifest saved to ${MANIFEST_PATH}`);
  console.log(`Total: ${volumes.length} volumes, ${allChapters.length} chapters, ${totalFiles} files`);
}

main().catch((err) => {
  console.error("Discovery failed:", err);
  process.exit(1);
});
