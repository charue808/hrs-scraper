import * as cheerio from "cheerio";
import {
  BASE_URL,
  DATA_DIR,
  MANIFEST_PATH,
  type Volume,
  type Chapter,
  type SectionFile,
  type Manifest,
} from "./config";
import { fetchPage, closeBrowser } from "./fetcher";

/** Extract directory/file links from an IIS directory listing page */
function parseDirectoryListing(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    // Skip parent directory and non-relative links
    if (href.startsWith("/") || href.startsWith("..") || href.startsWith("http")) return;
    links.push(href);
  });

  return links;
}

/** Discover all volumes from the root HRS directory */
async function discoverVolumes(): Promise<Volume[]> {
  console.log("Discovering volumes...");
  const html = await fetchPage(BASE_URL);
  const links = parseDirectoryListing(html, BASE_URL);

  const volumes: Volume[] = [];
  for (const link of links) {
    // Match patterns like "Vol01_Ch0001-0042F/"
    const match = link.match(/^(Vol(\d+)_Ch(.+?))\/?$/);
    if (match) {
      volumes.push({
        number: parseInt(match[2]!, 10),
        dirName: match[1]!,
        chapterRange: match[3]!,
        chapters: [],
      });
    }
  }

  volumes.sort((a, b) => a.number - b.number);
  console.log(`  Found ${volumes.length} volumes`);
  return volumes;
}

/** Discover chapters within a volume directory */
async function discoverChapters(volume: Volume): Promise<Chapter[]> {
  const volumeUrl = `${BASE_URL}${volume.dirName}/`;
  const html = await fetchPage(volumeUrl);
  const links = parseDirectoryListing(html, volumeUrl);

  const chapters: Chapter[] = [];
  for (const link of links) {
    // Match patterns like "HRS0001/" or "HRS0431K/" or special dirs
    const match = link.match(/^(HRS(\d{4}\w*))\/?$/i);
    if (match) {
      chapters.push({
        number: match[2]!,
        dirName: match[1]!,
        volumeNumber: volume.number,
        files: [],
      });
    }
  }

  chapters.sort((a, b) => a.number.localeCompare(b.number));
  return chapters;
}

/** Discover section files within a chapter directory */
async function discoverFiles(
  volume: Volume,
  chapter: Chapter
): Promise<SectionFile[]> {
  const chapterUrl = `${BASE_URL}${volume.dirName}/${chapter.dirName}/`;
  const html = await fetchPage(chapterUrl);
  const links = parseDirectoryListing(html, chapterUrl);

  const files: SectionFile[] = [];
  for (const link of links) {
    if (!link.toLowerCase().endsWith(".htm")) continue;
    const filename = decodeURIComponent(link);
    // Chapter index pages match pattern like "HRS_0001-.htm"
    const isIndex = /^HRS_\d{4}\w*-\.htm$/i.test(filename);
    files.push({
      filename,
      url: `${chapterUrl}${link}`,
      isIndex,
    });
  }

  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return files;
}

async function main() {
  console.log("HRS Discovery - Building manifest\n");

  // Ensure data directory exists
  await Bun.$`mkdir -p ${DATA_DIR}`.quiet();

  const volumes = await discoverVolumes();
  let totalFiles = 0;

  for (const volume of volumes) {
    console.log(
      `\nVolume ${volume.number} (${volume.dirName})`
    );
    volume.chapters = await discoverChapters(volume);
    console.log(`  Found ${volume.chapters.length} chapters`);

    for (const chapter of volume.chapters) {
      chapter.files = await discoverFiles(volume, chapter);
      totalFiles += chapter.files.length;
      const indexCount = chapter.files.filter((f) => f.isIndex).length;
      console.log(
        `    ${chapter.dirName}: ${chapter.files.length} files (${indexCount} index)`
      );
    }
  }

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    volumes,
    totalFiles,
  };

  await Bun.write(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  await closeBrowser();
  console.log(`\nManifest saved to ${MANIFEST_PATH}`);
  console.log(`Total: ${volumes.length} volumes, ${totalFiles} files`);
}

main().catch((err) => {
  console.error("Discovery failed:", err);
  process.exit(1);
});
