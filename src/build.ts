/**
 * Build the static site.
 *
 * Reads the committed corpus, resolves every citation against the real
 * inventory, and writes the whole document set as plain HTML: one page per
 * section, one per chapter, one per volume, and a home page. The markup itself
 * lives in `site.ts`.
 *
 *   bun run build                      # the whole corpus -> build/site
 *   bun run build -- --chapter 26      # one chapter, for reviewing by eye
 *   bun run build -- --out dist
 */
import { parseArgs } from "node:util";
import { readdirSync } from "node:fs";
import {
  CHAPTERS_PATH,
  MANIFEST_PATH,
  PARSED_DIR,
  type ChapterRecord,
  type Manifest,
  type ParsedSection,
} from "./config";
import { buildIndex, sectionSlug } from "./resolver";
import { chapterLabel, chapterPage, homePage, sectionPage, volumePage, STYLE } from "./site";
import { pool } from "./fetcher";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { chapter: { type: "string" }, out: { type: "string" } },
  allowPositionals: true,
});

const OUT = values.out ?? "build/site";
const ONLY_CHAPTER = values.chapter;

/** Sort by the numeric parts of a number so 26-9 precedes 26-10. */
const sortKey = (n: string) =>
  (n.match(/\d+|[A-Za-z]+/g) ?? []).map((p) => (/\d/.test(p) ? p.padStart(8, "0") : p)).join("");

const started = Date.now();

const manifest: Manifest = await Bun.file(MANIFEST_PATH).json();
const chapterRecords: Record<string, ChapterRecord> = (await Bun.file(CHAPTERS_PATH).exists())
  ? await Bun.file(CHAPTERS_PATH).json()
  : {};

// Read the corpus once. `bodyHtml` is ~46% of the payload and is never
// rendered, so it is dropped on load rather than carried through the build.
const files = readdirSync(PARSED_DIR);
const corpus: ParsedSection[] = new Array(files.length);
await pool(files, 32, async (file, i) => {
  const { bodyHtml, ...section } = (await Bun.file(`${PARSED_DIR}/${file}`).json()) as ParsedSection;
  corpus[i] = section as ParsedSection;
});

const index = await buildIndex(corpus);

const byChapter = new Map<string, ParsedSection[]>();
for (const section of corpus) {
  const list = byChapter.get(section.chapterNumber);
  if (list) list.push(section);
  else byChapter.set(section.chapterNumber, [section]);
}
for (const list of byChapter.values()) {
  list.sort((a, b) => sortKey(a.sectionNumber).localeCompare(sortKey(b.sectionNumber)));
}

/**
 * A slug collision would have one section silently overwrite another — the same
 * failure the scraper guards against on section numbers, one layer down. 24,600
 * files is too many to notice it by eye.
 */
const seen = new Map<string, string>();
for (const section of corpus) {
  const slug = sectionSlug(section.sectionNumber);
  const other = seen.get(slug);
  if (other) {
    console.error(`slug collision: ${other} and ${section.sectionNumber} both -> ${slug}`);
    process.exit(1);
  }
  seen.set(slug, section.sectionNumber);
}

const wantChapter = (number: string) => !ONLY_CHAPTER || number === ONLY_CHAPTER;

const write = (path: string, html: string) => Bun.write(`${OUT}/${path}/index.html`, html);

let sectionCount = 0;
let chapterCount = 0;

for (const volume of manifest.volumes) {
  const chapters = volume.chapters.filter((c) => wantChapter(c.number));
  if (!chapters.length) continue;

  for (const chapter of chapters) {
    const sections = byChapter.get(chapter.number) ?? [];
    const record = chapterRecords[chapter.number];
    const label = chapterLabel(chapter.number, record);
    // `02-HNP` and `03-ORG` have no index page, so they get no source link.
    const chapterSource = chapter.files.find((f) => f.isIndex);

    await write(
      `hrs/chapter/${chapter.number}`,
      chapterPage(chapter.number, record, volume.number, sections, index, chapterSource)
    );
    chapterCount++;

    await pool(sections, 32, async (section, i) => {
      await write(
        `hrs/${sectionSlug(section.sectionNumber)}`,
        sectionPage(
          section,
          {
            chapterLabel: label,
            volume: volume.number,
            prev: sections[i - 1],
            next: sections[i + 1],
          },
          index
        )
      );
    });
    sectionCount += sections.length;
  }

  if (ONLY_CHAPTER) continue;
  await write(
    `hrs/volume/${volume.number}`,
    volumePage(
      volume.number,
      volume.chapterRange.replace(/^0+/, "").replace(/-0+/, "–"),
      volume.chapters.map((c) => ({
        number: c.number,
        record: chapterRecords[c.number],
        sections: (byChapter.get(c.number) ?? []).length,
      })),
      { url: `${manifest.baseUrl}${volume.dirName}/`, dirName: volume.dirName }
    )
  );
}

await Bun.write(`${OUT}/style.css`, STYLE.trim() + "\n");

if (!ONLY_CHAPTER) {
  await Bun.write(
    `${OUT}/index.html`,
    homePage(
      manifest.volumes.map((v) => ({
        number: v.number,
        range: v.chapterRange.replace(/^0+/, "").replace(/-0+/, "–"),
        chapters: v.chapters.length,
      })),
      { sections: corpus.length, chapters: manifest.volumes.reduce((n, v) => n + v.chapters.length, 0) },
      manifest.baseUrl
    )
  );
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `${sectionCount} sections + ${chapterCount} chapters -> ${OUT}/ in ${seconds}s`
);
