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
import { readdirSync, rmSync } from "node:fs";
import {
  CHAPTERS_PATH,
  MANIFEST_PATH,
  PARSED_DIR,
  type ChapterRecord,
  type Manifest,
  type ParsedSection,
} from "./config";
import { buildIndex, sectionSlug } from "./resolver";
import { buildGraph, serializeGraph } from "./graph";
import { countWords, serializeVocabulary } from "./vocabulary";
import {
  chapterLabel,
  chapterPage,
  homePage,
  notFoundPage,
  searchPage,
  sectionPage,
  volumePage,
  STYLE,
} from "./site";
import { HTACCESS, robots, sitemap } from "./hosting";
import { pool } from "./fetcher";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    chapter: { type: "string" },
    out: { type: "string" },
    "no-index": { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const OUT = values.out ?? "build/site";
const ONLY_CHAPTER = values.chapter;
/** The public origin, for the sitemap. Unset locally; set in .env for a deploy. */
const SITE_URL = process.env.SITE_URL?.replace(/\/$/, "");

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

// The graph is built once here and used two ways: baked into each page as
// backlinks, and emitted as citations.json so the question is answerable
// without re-detecting. History is excluded from it — see graph.ts.
const graph = buildGraph(corpus, index);

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

// A full build owns these directories outright. Clearing them first means a
// section that leaves the code after a re-scrape also leaves the site, rather
// than surviving as a stale page that nothing links to but a crawler still
// finds. Only these two: `--out` can point anywhere, and the build should never
// delete something it did not write.
if (!ONLY_CHAPTER) {
  rmSync(`${OUT}/hrs`, { recursive: true, force: true });
  rmSync(`${OUT}/pagefind`, { recursive: true, force: true });
}

/** Every page path, for the sitemap. */
const paths: string[] = ["/"];

const write = (path: string, html: string) => {
  paths.push(`/${path}`);
  return Bun.write(`${OUT}/${path}/index.html`, html);
};

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
      chapterPage(
        chapter.number,
        record,
        volume.number,
        sections,
        index,
        chapterSource,
        graph.citedBy.get(chapter.number)
      )
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
            citedBy: graph.citedBy.get(section.sectionNumber),
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

// A favicon, so every page load stops emitting a 404 for one. Inline SVG rather
// than a binary: it is three lines, scales, and needs no build step.
await Bun.write(
  `${OUT}/favicon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#1a1a1a"/>
  <text x="16" y="23" font-family="Georgia, serif" font-size="20" font-weight="bold"
        fill="#fbfaf7" text-anchor="middle">\u00A7</text>
</svg>
`
);

// Published alongside the site: the whole graph, so "what cites this?" is
// answerable without a build and rendering can be regenerated without
// re-detecting. Only emitted on a full build — a --chapter subset would
// produce a graph that silently omits most of the corpus.
if (!ONLY_CHAPTER) {
  await Bun.write(`${OUT}/citations.json`, serializeGraph(graph));
  await Bun.write(`${OUT}/search/index.html`, searchPage());
  await Bun.write(`${OUT}/404.html`, notFoundPage());
  // What the host needs beyond the pages. See hosting.ts.
  await Bun.write(`${OUT}/.htaccess`, HTACCESS);
  await Bun.write(`${OUT}/robots.txt`, robots(SITE_URL));
  if (SITE_URL) await Bun.write(`${OUT}/sitemap.xml`, sitemap(SITE_URL, paths));
  // Pagefind cannot tell a typo from a rare term; the corpus can. See
  // vocabulary.ts for why this is worth 70 KB on the search page alone.
  await Bun.write(`${OUT}/search-vocabulary.txt`, serializeVocabulary(countWords(corpus)));
  await Bun.write(`${OUT}/search.js`, Bun.file("src/search-client.js"));
}

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

// Pagefind reads the HTML that was just written, so it has to run last. Skipped
// for a --chapter subset, which would index a fraction of the corpus and give a
// search box that confidently reports nothing.
if (!ONLY_CHAPTER && !values["no-index"]) {
  const at = Date.now();
  const { $ } = await import("bun");
  await $`bunx pagefind --site ${OUT} --output-subdir pagefind`.quiet();
  console.log(`search index -> ${OUT}/pagefind/ in ${((Date.now() - at) / 1000).toFixed(1)}s`);
}
