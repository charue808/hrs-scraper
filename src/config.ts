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
  isUncodified: boolean; // heading was bracketed, e.g. "[§11-1.52]"
  isRepealed: boolean;
  /** Whether sectionNumber came from the page text or was derived from the filename. */
  numberSource: "page" | "filename";
  filename: string;
  url: string;
}

export interface ParsedChapterIndex {
  chapterNumber: string;
  title: string;
  filename: string;
  url: string;
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
  "isUncodified",
  "isRepealed",
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

export const DATABASE_URL = process.env.DATABASE_URL;
