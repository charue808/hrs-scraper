// --- Types ---

/**
 * Which corpus a document belongs to. Volume 1 carries several non-HRS
 * documents (the US and Hawaii constitutions, the Hawaiian Homes Commission
 * Act, etc.) in their own directories alongside the numbered HRS chapters.
 */
export type DocType =
  | "hrs"
  | "const"
  | "uscon"
  | "hhca"
  | "adm"
  | "org"
  | "hnp";

export interface Volume {
  number: number;
  dirName: string; // e.g. "Vol01_Ch0001-0042F"
  chapterRange: string; // e.g. "0001-0042F"
  chapters: Chapter[];
}

export interface Chapter {
  number: string; // normalized, e.g. "1", "431K", or "05-CONST"
  dirName: string; // e.g. "HRS0001" or "05-CONST"
  volumeNumber: number;
  title: string; // filled in from the chapter index page during scraping
  files: SectionFile[];
}

export interface SectionFile {
  filename: string; // e.g. "HRS_0001-0001.htm"
  url: string;
  isIndex: boolean; // true for chapter index pages like "HRS_0001-.htm"
}

/** One annotation block, keyed by its heading (`p.XNotesHeading`). */
export interface Annotation {
  heading: string; // e.g. "Case Notes", "COMMENTARY ON §701-100"
  text: string;
}

/**
 * The span of sections a single page covers, when its heading states a range
 * rather than one section — `§515-10 to 515-12 REPEALED.`
 *
 * 274 pages in the corpus are shaped this way. The distinction matters because
 * a range heading does not identify which section *this file* is: several
 * filenames can point at the same range page, and the file is not always the
 * range's start (`HRS_0425-0180.htm` is the end of §425-151 to 425-180). So
 * the section number comes from the filename on these pages, and the span is
 * recorded here rather than left as a prose fragment in the title.
 */
export interface SectionRange {
  start: string; // e.g. "§425-151"
  end: string; // e.g. "§425-180"
  /** The range exactly as the heading writes it, before normalization. */
  raw: string;
}

/**
 * A discrepancy between what the published source says and what is true.
 *
 * The HRS contains typographical errors — `HRS_0634G-0002.htm` is headed
 * `§643G-2` for a chapter that does not exist. We correct the section's
 * *identity* so navigation and citation resolution work, keep its *displayed
 * text* faithful to the source, and carry this record so the rendered page can
 * generate an editorial note explaining the difference.
 *
 * `corrected` is null when `confidence` is `flagged`: something is wrong but
 * the right answer is not established, so nothing is changed. See
 * `docs/source-anomalies.md`.
 */
export interface SourceAnomaly {
  field: string; // e.g. "sectionNumber"
  observed: string; // what the source document says
  corrected: string | null; // null when confidence is "flagged"
  confidence: "conclusive" | "flagged";
  evidence: string;
}

export interface ParsedSection {
  sectionNumber: string; // e.g. "§1-1" or "§431:10A-601"
  title: string;
  bodyText: string;
  bodyHtml: string;
  history: string; // legislative history "[L 1972, c 9, ...]"
  crossReferences: string[];
  caseNotes: string;
  annotations: Annotation[]; // every annotation block, including the two above
  partHeading: string | null;
  chapterNumber: string;
  docType: DocType;
  /**
   * The heading was bracketed, e.g. `[§11-1.52]` — supplied by the revisor.
   *
   * Called `isUncodified` until 2026-09-12, which was wrong: brackets do not
   * mark an uncodified section. 7,859 sections
   * (33.6%) carry one, and they are plainly printed in the HRS. What the corpus
   * says in its own Revision Notes is that brackets mark material *supplied by
   * the revisor* rather than enacted by the legislature — "Bracketed words ...
   * added by revisor", "Part heading added by revisor pursuant to §23G-15" —
   * and that the legislature ratifies such material by deleting the brackets.
   * §23G-15(1) grants the revisor authority to number and renumber sections,
   * which is what a bracketed heading records.
   *
   * The statute's *text* is enacted law either way; only the heading is
   * editorial. `titleIsSupplied` is the same convention at narrower scope.
   * See `docs/project-plan.md`, The bracket convention.
   */
  headingIsSupplied: boolean;
  isRepealed: boolean;
  /**
   * Set when the heading covers a span of sections rather than one section.
   * `null` on the overwhelming majority. See `SectionRange`.
   */
  covers: SectionRange | null;
  /**
   * The heading bracketed the *title* but not the number
   * (`§604-13  [Arrest under warrant.]`), which by HRS convention marks a
   * catchline supplied editorially rather than enacted. Distinct from
   * `headingIsSupplied`, where the bracket encloses the whole heading. Both
   * record the same convention applied at different scope.
   */
  titleIsSupplied: boolean;
  /**
   * Discrepancies between this page and the published source, from the reviewed
   * `data/corrections.json`. Empty on the overwhelming majority. See
   * `SourceAnomaly` and `docs/source-anomalies.md`.
   */
  sourceAnomalies: SourceAnomaly[];
  /**
   * How `sectionNumber` was obtained. `page-range` means the page stated a
   * range heading, which confirms the section exists but cannot identify which
   * file it is — so the number was taken from the filename (see `SectionRange`).
   * `correction` means the source's own number is wrong and a reviewed entry in
   * `data/corrections.json` supplied the right one (see `sourceAnomalies`).
   */
  numberSource: "page" | "filename" | "page-range" | "correction";
  filename: string;
  url: string;
}

export interface ParsedChapterIndex {
  chapterNumber: string;
  title: string;
  /**
   * Chapter-level text sitting between the banner and the section listing —
   * in practice a repeal note (`REPEALED. L 1981, c 135, §2.`). Empty on
   * chapters that go straight into their listing.
   *
   * This is the only content 293 chapters have. Their sections were all
   * repealed, so no file in `data/parsed` carries their number and a chapter
   * page built from parsed sections alone would render blank. Measured: none
   * of those 293 has a section listing, and 290 have notes.
   */
  notes: string;
  /**
   * Annotation blocks belonging to the chapter itself, scoped to what follows
   * the live `CHAPTER n` banner.
   *
   * The scoping is the whole point: an index page often opens with a
   * division/title table of contents carrying its *own* Cross References
   * (`HRS_0091-.htm` has one for TITLE 8), and a superseded `[OLD]` banner
   * brings its own as well. Both precede the live banner and belong to
   * something other than this chapter.
   */
  annotations: Annotation[];
  filename: string;
  url: string;
}

/**
 * One entry in `data/chapters.json` — the chapter-level data that lives on a
 * chapter index page rather than on any section. Built by `bun run chapters`.
 *
 * `notes` and `annotations` are omitted rather than written empty: most
 * chapters have neither, and this file is committed and read as a diff.
 */
export interface ChapterRecord {
  title: string;
  volume: number;
  /** Chapter-level prose, in practice a repeal note. */
  notes?: string;
  /** The chapter's own annotation blocks. */
  annotations?: Annotation[];
}

/**
 * What a title's banner page says about the title, before its first chapter's
 * `CHAPTER n` line. Read by `parseTitleBanner`, assembled into `data/titles.json`
 * by `bun run chapters`.
 *
 * The HRS is Division > Title > (Subtitle) > Chapter. Volumes, which the site
 * navigated by first, are how the printed edition is bound and mean nothing to a
 * citation; "Title 12" is what the code itself says. The hierarchy is stated
 * outright on exactly one index page per title — the first chapter's — as a
 * DIVISION banner (on the first title of each division), a TITLE banner, and a
 * table of contents of the title's chapters. 41 pages carry it.
 */
export interface ParsedTitleBanner {
  /** Present only on the first title of a division. */
  division?: { number: number; name: string };
  /** `1`, `23A`. */
  number: string;
  name: string;
  /** The banner was bracketed — supplied by the revisor, like a bracketed heading. */
  supplied: boolean;
  /**
   * The table of contents as printed. Titles 6 and 12 divide into subtitles,
   * labelled as the source does (`Subtitle 1. Public Lands`); every other
   * title is a single unnamed group.
   */
  listing: { subtitle?: string; chapters: { number: string; name: string }[] }[];
  /** Title-level prose without a heading — in practice a codification note. */
  notes: string;
  annotations: Annotation[];
}

/** One title in `data/titles.json`. */
export interface TitleRecord extends Omit<ParsedTitleBanner, "division"> {
  division: number;
  /**
   * Chapters in the corpus that the printed table of contents does not list —
   * added after it was last set, presumably. Placed in `listing` by number and
   * named here so the gap is visible.
   */
  unlisted?: string[];
  /** The index page the banner was read from. */
  source: string;
}

export interface TitlesFile {
  divisions: { number: number; name: string }[];
  titles: TitleRecord[];
}

/**
 * Field order for serialized `ParsedSection` JSON.
 *
 * `data/parsed` is committed, which makes git the version store for the corpus:
 * a re-scrape after a legislative session produces a diff showing exactly which
 * sections were amended. That only works if the serialization is byte-stable —
 * otherwise every run rewrites all 24,505 files and the diffs are worthless.
 *
 * Object-literal key order happens to be stable today, but it is implicit:
 * reordering the literal in `parser.ts` would silently churn the whole corpus.
 * Declaring the order here makes changing it a deliberate act.
 *
 * Adding a field is safe (it appends). Reordering or renaming rewrites every
 * file, so do it in its own commit, separate from any content change.
 */
export const SECTION_FIELD_ORDER: readonly (keyof ParsedSection)[] = [
  "sectionNumber",
  "title",
  "chapterNumber",
  "docType",
  "partHeading",
  "bodyText",
  "history",
  "crossReferences",
  "caseNotes",
  "annotations",
  "headingIsSupplied",
  "isRepealed",
  "covers",
  "titleIsSupplied",
  "sourceAnomalies",
  "numberSource",
  "filename",
  "url",
  // Kept last: ~46% of the payload, and only a fallback for debugging parse
  // issues. The rendered site is built from the structured fields above, never
  // from this markup.
  "bodyHtml",
];

/**
 * Serialize a parsed section deterministically: declared key order, two-space
 * indent, trailing newline. See `SECTION_FIELD_ORDER`.
 */
export function serializeSection(section: ParsedSection): string {
  const ordered: Record<string, unknown> = {};
  for (const key of SECTION_FIELD_ORDER) ordered[key] = section[key];

  // Guard against a field being added to ParsedSection but not to the order
  // list, which would otherwise drop it from disk silently.
  for (const key of Object.keys(section)) {
    if (!(key in ordered)) ordered[key] = section[key as keyof ParsedSection];
  }

  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export interface Manifest {
  createdAt: string;
  baseUrl: string;
  volumes: Volume[];
  totalFiles: number;
}

export interface Progress {
  lastUpdated: string;
  completedFiles: string[]; // URLs already processed
  failedFiles: { url: string; error: string }[];
}

// --- Constants ---

/**
 * Primary host. `data.capitol.hawaii.gov` mirrors the same static files as
 * `www.capitol.hawaii.gov` but is not behind Cloudflare, so it serves plain
 * `fetch` requests. The www host 403s everything that is not a real browser.
 */
export const BASE_URL = "https://data.capitol.hawaii.gov/hrscurrent/";

/** Cloudflare-protected mirror, reachable only via the Puppeteer fallback. */
export const FALLBACK_BASE_URL = "https://www.capitol.hawaii.gov/hrscurrent/";

export const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Minimum spacing between request starts, applied globally across workers. */
export const RATE_LIMIT_MS = 120;
export const MAX_CONCURRENT = 5;
export const MAX_RETRIES = 3;
export const RETRY_BACKOFF_MS = 1000;
export const REQUEST_TIMEOUT_MS = 30_000;

export const DATA_DIR = "data";
export const MANIFEST_PATH = `${DATA_DIR}/manifest.json`;
export const PROGRESS_PATH = `${DATA_DIR}/progress.json`;
export const PARSED_DIR = `${DATA_DIR}/parsed`;
export const HTML_DIR = `${DATA_DIR}/html`;
/** Reviewed record of errors in the published source. See docs/source-anomalies.md. */
export const CORRECTIONS_PATH = `${DATA_DIR}/corrections.json`;
/** Chapter number -> title, built from the chapter index pages by `bun run chapters`. */
export const CHAPTERS_PATH = `${DATA_DIR}/chapters.json`;
/** Division > Title > Chapter, from the 41 title banner pages. Also by `bun run chapters`. */
export const TITLES_PATH = `${DATA_DIR}/titles.json`;

export const DATABASE_URL = process.env.DATABASE_URL;
