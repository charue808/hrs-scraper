import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type {
  Annotation,
  DocType,
  ParsedChapterIndex,
  ParsedSection,
} from "./config";

const DOC_TYPES: Record<string, DocType> = {
  HRS: "hrs",
  CONST: "const",
  USCON: "uscon",
  HHCA: "hhca",
  ADM: "adm",
  ORG: "org",
  HNP: "hnp",
};

/**
 * Normalize Word's typography: non-breaking spaces, and the hyphen variants
 * the HRS uses inside section numbers (`\u2011` appears in "\u00A711\u20113"). The en dash
 * is left alone, since it is prose punctuation rather than part of a number.
 */
function clean(text: string): string {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/[\u2010\u2011\u2012]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingZeros(s: string): string {
  // Preserve letters at the end (e.g., "010A" -> "10A")
  const match = s.match(/^0*(\d+.*)$/);
  if (match) return match[1] || "0";
  return s;
}

/**
 * Strip the extension and any trailing markers, leaving `PREFIX_rest`.
 * Handles the handful of oddities in the corpus: `.docx.htm` double
 * extensions, a soft hyphen in one filename, and one `_[OLD]` variant.
 */
function normalizeFilename(filename: string): { prefix: string; rest: string; suffix: string } {
  let base = filename
    .replace(/­/g, "") // soft hyphen, in HRS_0291-0024_0004.htm
    .replace(/\.html?$/i, "")
    .replace(/\.docx$/i, "");

  let suffix = "";
  const oldMatch = base.match(/^(.*)_\[([^\]]+)\]$/);
  if (oldMatch) {
    base = oldMatch[1]!;
    suffix = ` [${oldMatch[2]!}]`;
  }

  const prefixMatch = base.match(/^([A-Za-z]+)_(.*)$/);
  if (!prefixMatch) return { prefix: "HRS", rest: base, suffix };
  return { prefix: prefixMatch[1]!.toUpperCase(), rest: prefixMatch[2]!, suffix };
}

/** Split on `-` and `_` while keeping track of which separator preceded each part. */
function splitBySeparator(rest: string): { hyphen: string[]; underscore: string[] } {
  const tokens = rest.split(/([-_])/);
  const hyphen: string[] = [tokens[0] ?? ""];
  const underscore: string[] = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const value = tokens[i + 1] ?? "";
    if (tokens[i] === "-") hyphen.push(value);
    else underscore.push(value);
  }
  return { hyphen, underscore };
}

export function docTypeFromFilename(filename: string): DocType {
  return DOC_TYPES[normalizeFilename(filename).prefix] ?? "hrs";
}

/** True for chapter index pages, which are named with a trailing separator. */
export function isIndexFilename(filename: string): boolean {
  const { rest } = normalizeFilename(filename);
  return rest === "" || rest.endsWith("-") || rest.endsWith("_");
}

/**
 * Convert an HRS filename to a section number.
 *
 * The separator carries the meaning, which is why this splits on `-` and `_`
 * separately rather than treating them alike:
 *   - a second hyphen introduces an article  (`HRS_0431-0001-0100` -> §431:1-100)
 *   - an underscore introduces a decimal     (`HRS_0001-0004_0005` -> §1-4.5)
 *   - repeated underscores concatenate       (`HRS_0011-0001_0005_0002` -> §11-1.52)
 */
export function filenameToSectionNumber(filename: string): string {
  const { prefix, rest, suffix } = normalizeFilename(filename);
  const { hyphen, underscore } = splitBySeparator(rest);
  const decimals = underscore.map(stripLeadingZeros).join("");

  if (prefix !== "HRS") {
    // Non-HRS documents (constitutions, HHCA, ...) have no chapter/article
    // grammar to honor, so keep their components in filename order.
    const joined = hyphen.filter(Boolean).map(stripLeadingZeros).join("-");
    const number = decimals ? `${joined}.${decimals}` : joined;
    return `${prefix} §${number}${suffix}`;
  }

  const chapter = stripLeadingZeros(hyphen[0] ?? "");
  const parts = hyphen.slice(1).filter(Boolean);

  let number: string;
  if (parts.length === 0) {
    number = chapter; // chapter index page, e.g. "HRS_0001-.htm"
  } else if (parts.length === 1) {
    number = `${chapter}-${stripLeadingZeros(parts[0]!)}`;
  } else {
    number = `${chapter}:${stripLeadingZeros(parts[0]!)}-${stripLeadingZeros(parts[1]!)}`;
  }

  if (decimals) number += `.${decimals}`;
  return `§${number}${suffix}`;
}

/** Extract the chapter number a section file belongs to. */
export function extractChapterFromFilename(filename: string): string {
  const { prefix, rest } = normalizeFilename(filename);
  if (prefix !== "HRS") return prefix;
  return stripLeadingZeros(splitBySeparator(rest).hyphen[0] ?? "");
}

/**
 * Normalize a directory name into the chapter number used as the join key.
 * `HRS0001` -> `1`, `HRS0431K` -> `431K`. Special directories such as
 * `05-CONST` are already unique identifiers and are kept verbatim.
 */
export function normalizeChapterNumber(dirName: string): string {
  const match = dirName.match(/^HRS(\d+[A-Za-z]*)$/i);
  return match ? stripLeadingZeros(match[1]!) : dirName;
}

// --- HTML parsing ---

interface Run {
  text: string;
  bold: boolean;
}

/** Flatten a paragraph into text runs tagged with whether they are bold. */
function textRuns(el: Element): Run[] {
  const runs: Run[] = [];
  const walk = (node: AnyNode, bold: boolean): void => {
    if (node.type === "text") {
      runs.push({ text: node.data, bold });
      return;
    }
    if (node.type === "tag") {
      const name = node.name.toLowerCase();
      const nowBold = bold || name === "b" || name === "strong";
      for (const child of node.children) walk(child, nowBold);
    }
  };
  for (const child of el.children) walk(child, false);
  return runs;
}

/**
 * Isolate the bolded heading run that opens a section paragraph.
 *
 * Word splits headings across several <b> elements (`<b>§1</b>-<b>2 Title.</b>`),
 * so this walks runs from the start, accepting bold runs and the short
 * unbolded connectors between them, and stops at the first real prose run.
 */
function leadingBoldText(runs: Run[]): string {
  let end = -1;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.bold) {
      end = i;
      continue;
    }
    if (clean(run.text).length <= 3) continue;
    break;
  }
  if (end === -1) return "";
  return clean(runs.slice(0, end + 1).map((r) => r.text).join(""));
}

const HEADING_RE = /^\[?\s*§+\s*([0-9][0-9A-Za-z:.\-]*[0-9A-Za-z])\s*\]?\s+(.*)$/;
const STRUCTURAL_RE = /^(PART|SUBPART|ARTICLE|DIVISION|TITLE|CHAPTER)\s+[IVXLCDM0-9]/i;
// Legislative history is a bracketed span carrying a year. The prefix varies
// (L, RL, CC, AC, am L, ...), so the year is the reliable marker.
const HISTORY_RE = /\[[^\[\]]*\b(?:1[6-9]\d{2}|20\d{2})\b[^\[\]]*\]/g;

interface Block {
  kind: "body" | "annotation";
  heading: string | null; // null for the statute body
  paragraphs: string[];
  elements: Element[];
}

/**
 * Split a page into its body and its annotation blocks.
 *
 * The markup is generated by Word and carries a small, stable class
 * vocabulary: `XNotesHeading` opens an annotation block and `XNotes` holds its
 * text. Everything before the first `XNotesHeading` is the statute itself.
 */
function splitBlocks($: cheerio.CheerioAPI, root: cheerio.Cheerio<Element>): Block[] {
  const blocks: Block[] = [{ kind: "body", heading: null, paragraphs: [], elements: [] }];

  root.find("p").each((_, el) => {
    const classes = ($(el).attr("class") ?? "").split(/\s+/);
    const text = clean($(el).text());

    if (classes.includes("XNotesHeading")) {
      if (text) {
        blocks.push({ kind: "annotation", heading: text, paragraphs: [], elements: [] });
      }
      return;
    }
    if (!text) return;

    let block = blocks[blocks.length - 1]!;

    // An annotation can precede the section: a PART banner, then a Note about
    // the part, then the section itself. A statute heading therefore reopens
    // the body rather than being swallowed by the annotation above it.
    if (
      block.kind === "annotation" &&
      !classes.includes("XNotes") &&
      HEADING_RE.test(leadingBoldText(textRuns(el)))
    ) {
      block = { kind: "body", heading: null, paragraphs: [], elements: [] };
      blocks.push(block);
    }

    block.paragraphs.push(text);
    block.elements.push(el);
  });

  return blocks;
}

export function parseSection(
  html: string,
  filename: string,
  url: string,
  chapterNumber?: string
): ParsedSection {
  const $ = cheerio.load(html);
  $("script, style, #pageLinks").remove();

  const section = $("div.WordSection1");
  const root = (section.length ? section : $("body")) as cheerio.Cheerio<Element>;

  const blocks = splitBlocks($, root);
  const bodyBlocks = blocks.filter((block) => block.kind === "body");
  const body = {
    paragraphs: bodyBlocks.flatMap((block) => block.paragraphs),
    elements: bodyBlocks.flatMap((block) => block.elements),
  };
  const annotations: Annotation[] = blocks
    .filter((block) => block.kind === "annotation")
    .map((block) => ({ heading: block.heading!, text: block.paragraphs.join("\n") }));

  // --- section number and title, taken from the page where possible ---
  let sectionNumber = filenameToSectionNumber(filename);
  let numberSource: ParsedSection["numberSource"] = "filename";
  let title = "";
  let isUncodified = false;
  let partHeading: string | null = null;

  const headingIndex = body.elements.findIndex((el) => {
    const heading = leadingBoldText(textRuns(el));
    return heading !== "" && HEADING_RE.test(heading);
  });

  if (headingIndex !== -1) {
    const heading = leadingBoldText(textRuns(body.elements[headingIndex]!));
    const match = heading.match(HEADING_RE)!;
    const suffix = normalizeFilename(filename).suffix;
    sectionNumber = `§${match[1]!}${suffix}`;
    numberSource = "page";
    title = match[2]!.trim();
    isUncodified = heading.startsWith("[");

    // Drop the heading from the body so bodyText starts at the statute text.
    const paragraph = body.paragraphs[headingIndex]!;
    body.paragraphs[headingIndex] = paragraph.startsWith(heading)
      ? paragraph.slice(heading.length).trim()
      : paragraph;
  }

  // A PART/ARTICLE banner sits above the section heading when one is present.
  // With no heading at all, the opening paragraph is itself the banner.
  const bannerEnd = headingIndex === -1 ? 1 : headingIndex;
  for (const paragraph of body.paragraphs.slice(0, bannerEnd)) {
    if (STRUCTURAL_RE.test(paragraph)) {
      partHeading = paragraph;
      break;
    }
  }

  let bodyText = body.paragraphs.filter(Boolean).join("\n\n");

  // --- legislative history: the last bracketed span carrying a year ---
  const historyMatches = bodyText.match(HISTORY_RE);
  const history = historyMatches ? historyMatches[historyMatches.length - 1]! : "";
  if (history) {
    const at = bodyText.lastIndexOf(history);
    const stripped = (bodyText.slice(0, at) + bodyText.slice(at + history.length)).trim();
    // Some pages are nothing but a bracketed repeal note. Keep the text there
    // rather than reducing the section to an empty body.
    if (stripped) bodyText = stripped;
  }

  const findAnnotation = (pattern: RegExp): Annotation | undefined =>
    annotations.find((a) => pattern.test(a.heading));

  const crossReferences = (findAnnotation(/^cross\s+references?$/i)?.text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const caseNotes = findAnnotation(/^case\s+notes?$/i)?.text ?? "";

  // Repeals show up three ways: in the title, as a body opening with
  // "Repealed", or as a body that is nothing but a bracketed repeal note.
  const isRepealed =
    /\brepealed\b/i.test(title) ||
    /^\s*\[?\s*repealed\b/i.test(bodyText) ||
    /^\s*\[[^\]]*\brepealed\b[^\]]*\]\s*$/i.test(bodyText);

  return {
    sectionNumber,
    title,
    bodyText,
    bodyHtml: root.html() ?? "",
    history,
    crossReferences,
    caseNotes,
    annotations,
    partHeading,
    chapterNumber: chapterNumber ?? extractChapterFromFilename(filename),
    docType: docTypeFromFilename(filename),
    isUncodified,
    isRepealed,
    numberSource,
    filename,
    url,
  };
}

/**
 * Parse a chapter index page for the chapter's title.
 *
 * Index pages open with `CHAPTER <number>` followed by the title, though some
 * are preceded by division/title banners and a table of contents for the whole
 * title, so the `CHAPTER` line is located rather than assumed to be first.
 */
export function parseChapterIndex(
  html: string,
  filename: string,
  url: string,
  chapterNumber?: string
): ParsedChapterIndex {
  const $ = cheerio.load(html);
  $("script, style, #pageLinks").remove();

  const section = $("div.WordSection1");
  const root = section.length ? section : $("body");

  const paragraphs = root
    .find("p")
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);

  let title = "";
  const chapterIndex = paragraphs.findIndex((p) => /^chapter\s+[0-9]/i.test(p));
  if (chapterIndex !== -1) {
    const next = paragraphs
      .slice(chapterIndex + 1)
      .find((p) => !/^section$/i.test(p));
    if (next && !/^[0-9]/.test(next)) title = next;
  }

  return {
    chapterNumber: chapterNumber ?? extractChapterFromFilename(filename),
    title,
    filename,
    url,
  };
}
