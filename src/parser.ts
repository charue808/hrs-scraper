import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type {
  Annotation,
  DocType,
  ParsedChapterIndex,
  ParsedSection,
  ParsedTitleBanner,
  SectionRange,
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

/**
 * Normalize one component of a section number: drop leading zeros and
 * uppercase any letter suffix.
 *
 * Chapter and section letters are uppercase by HRS convention (`6D`, `431K`,
 * `10H`), and the page text always writes them that way — but a handful of
 * filenames are lowercase (`HRS_0039a-0112.htm`, `HRS_0302l-0002.htm`). Left
 * alone those yield `§39a-112`, which matches neither the page nor anything in
 * the resolver's index.
 */
function normalizeComponent(s: string): string {
  // Preserve letters at the end (e.g., "010A" -> "10A")
  const match = s.match(/^0*(\d+.*)$/);
  return (match ? match[1] || "0" : s).toUpperCase();
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
  const decimals = underscore.map(normalizeComponent).join("");

  if (prefix !== "HRS") {
    // Non-HRS documents (constitutions, HHCA, ...) have no chapter/article
    // grammar to honor, so keep their components in filename order.
    const joined = hyphen.filter(Boolean).map(normalizeComponent).join("-");
    const number = decimals ? `${joined}.${decimals}` : joined;
    return `${prefix} §${number}${suffix}`;
  }

  const chapter = normalizeComponent(hyphen[0] ?? "");
  const parts = hyphen.slice(1).filter(Boolean);

  let number: string;
  if (parts.length === 0) {
    number = chapter; // chapter index page, e.g. "HRS_0001-.htm"
  } else if (parts.length === 1) {
    number = `${chapter}-${normalizeComponent(parts[0]!)}`;
  } else {
    number = `${chapter}:${normalizeComponent(parts[0]!)}-${normalizeComponent(parts[1]!)}`;
  }

  if (decimals) number += `.${decimals}`;
  return `§${number}${suffix}`;
}

/** Extract the chapter number a section file belongs to. */
export function extractChapterFromFilename(filename: string): string {
  const { prefix, rest } = normalizeFilename(filename);
  if (prefix !== "HRS") return prefix;
  return normalizeComponent(splitBySeparator(rest).hyphen[0] ?? "");
}

/**
 * Normalize a directory name into the chapter number used as the join key.
 * `HRS0001` -> `1`, `HRS0431K` -> `431K`. Special directories such as
 * `05-CONST` are already unique identifiers and are kept verbatim.
 */
export function normalizeChapterNumber(dirName: string): string {
  const match = dirName.match(/^HRS(\d+[A-Za-z]*)$/i);
  return match ? normalizeComponent(match[1]!) : dirName;
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
    const text = clean(run.text);
    // A subsection marker ends the heading even though it is short enough to
    // look like a connector. Word writes `<b>§26-12 Department of education.
    // </b>(a)<b> </b>The department...`, and treating `(a)` as a connector both
    // appends it to the title and drops it from the body.
    if (/^\([0-9a-z]+\)$/i.test(text)) break;
    if (text.length <= 3) continue;
    break;
  }
  if (end === -1) return "";
  const heading = clean(runs.slice(0, end + 1).map((r) => r.text).join(""));

  // Word sometimes splits the marker across runs of its own — `(`, `a`, `)` —
  // so the per-run check above cannot see it. Strip it from the assembled
  // heading instead. Shortening the heading here also puts the marker back at
  // the front of the body, since the caller slices the heading off by length.
  // Bounded to 1-3 characters so a real title like "(Reserved)" survives.
  return heading.replace(/\s*\((?:\d{1,3}|[a-z]{1,3})\)\s*$/i, "");
}

const HEADING_RE = /^\[?\s*§+\s*([0-9][0-9A-Za-z:.\-]*[0-9A-Za-z])\s*\]?\s+(.*)$/;

// The non-HRS documents head their sections differently, and neither form is
// matched by HEADING_RE — which is why 276 of their titles were missing.
//
// `§73. Commissioner of public lands.` — the Organic Act, HHCA, Admission Act
// and Hawaii National Park Act put a period after the number and then the
// catchline, where one exists. The number must still end on an alphanumeric so
// `§220.5.` yields `220.5` and not `220.5.`.
const ACT_HEADING_RE = /^§+\s*([0-9](?:[0-9A-Za-z.\-]*[0-9A-Za-z])?)\s*\.\s*(.*)$/;
// `Section 5.` — both constitutions. The number here is the section *within its
// article*, and the article appears only in the filename, so this locates the
// heading rather than supplying a number. The catchline is not on this line at
// all; it sits in the centred paragraph above (see `catchlineAbove`).
const CONST_HEADING_RE = /^Section\s+([0-9]+[A-Za-z]?)\s*\.\s*(.*)$/i;

/**
 * Whether a bold run opens a section.
 *
 * The alternative forms are accepted only for the non-HRS documents, so the
 * 22,972 HRS sections keep exactly the behaviour they had.
 */
function isSectionHeading(heading: string, prefix: string): boolean {
  if (HEADING_RE.test(heading)) return true;
  if (prefix === "HRS") return false;
  return ACT_HEADING_RE.test(heading) || CONST_HEADING_RE.test(heading);
}

/**
 * Whether the paragraph above a constitutional heading is its catchline.
 *
 * The constitutions print the catchline as a centred, fully upper-case line
 * above `Section n.` — `DUE PROCESS AND EQUAL PROTECTION`. Measured across all
 * 179 such pages, 178 are entirely upper-case; the one exception is annotation
 * prose that leaked above a heading, which this correctly rejects. An ARTICLE
 * banner is excluded because it is the part heading, captured separately.
 */
function catchlineAbove(paragraph: string | undefined): string | null {
  if (!paragraph) return null;
  const text = paragraph.trim();
  if (!text || text.length > 90) return null;
  if (/[a-z]/.test(text)) return null;
  if (STRUCTURAL_RE.test(text)) return null;
  return text;
}
// The leading bracket is not optional decoration: the HRS brackets material
// supplied by the revisor rather than enacted, and it applies that convention to
// structural banners exactly as it does to section headings above. Both whole-
// banner (`[PART IV. THE EXECUTIVE BUDGET]`) and partial (`[PART VII.] ROUTINE
// REPAIR AND MAINTENANCE`) forms occur. Without the `\[?` this misses 298
// sections across 119 chapters — chapter 37 shows 4 of its 7 parts — and the
// banner text is left stranded in the body as a stray paragraph.
const STRUCTURAL_RE = /^\[?\s*(PART|SUBPART|ARTICLE|DIVISION|TITLE|CHAPTER)\s+[IVXLCDM0-9]/i;

// A section number as written in running text. Ending the class on an
// alphanumeric is what keeps a sentence-ending period out of the number:
// `to 516. REPEALED.` yields `516`, not `516.` — the same digit-must-follow
// rule the citation matcher uses. See docs/citation-linking.md.
// The tail is optional so a single-digit end matches: the corpus writes
// `§5-1 to 3 REPEALED.` as well as `§515-10 to 515-12`.
const RANGE_NUMBER = "[0-9](?:[0-9A-Za-z:.\\-]*[0-9A-Za-z])?";
// Requiring a digit after `to` is what separates the 274 range headings from
// the three real titles that begin with the word ("To heirs.").
const RANGE_HEAD_RE = new RegExp(`^to\\s+(${RANGE_NUMBER})`, "i");
// Some headings list several spans: "to 602-24, 602-31 to 602-34, and 602-37".
// The comma branch takes an optional `and`/`or` after it so the Oxford comma in
// "to 602-24, 602-31 to 602-34, 602-36, and 602-37" does not end the list early.
const RANGE_MORE_RE = new RegExp(
  `^(?:\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+and\\s+|\\s+or\\s+)(?:§+\\s*)?(${RANGE_NUMBER})` +
    `(?:\\s+to\\s+(${RANGE_NUMBER}))?`,
  "i"
);

/**
 * Expand the end of a range against its start.
 *
 * The corpus abbreviates the end when the chapter is unchanged — `§39-125 to
 * 131` means §39-131, not §131 — but also writes it in full
 * (`§431:10A-521 to 431:10A-531`). A `-` or `:` in the end token means it
 * already stands on its own.
 */
function expandRangeEnd(start: string, end: string): string {
  // Split any leading document prefix and section sign off the start number.
  const lead = start.match(/^(.*?§+\s*)/)?.[1] ?? "";
  const core = start.slice(lead.length).replace(/\s*\[[^\]]*\]\s*$/, "");

  if (/[-:]/.test(end)) return `${lead}${end}`;
  const at = core.lastIndexOf("-");
  return at === -1 ? `${lead}${end}` : `${lead}${core.slice(0, at + 1)}${end}`;
}

/**
 * Detect a heading that covers a span of sections rather than one, and split
 * the range expression off the title.
 *
 * `§515-10 to 515-12 REPEALED.` is one page standing for three sections. The
 * range must be consumed only at the *start* of the title text, since a title
 * can legitimately contain "to" further along — `to 349-14 Renumbered as
 * §§349-21 to 349-23.` is a range of two whose title mentions a different span.
 */
function parseRangeTitle(
  rest: string,
  start: string
): { covers: SectionRange; title: string } | null {
  const head = rest.match(RANGE_HEAD_RE);
  if (!head) return null;

  let consumed = head[0]!.length;
  let last = head[1]!;

  for (;;) {
    const more = rest.slice(consumed).match(RANGE_MORE_RE);
    if (!more) break;
    consumed += more[0]!.length;
    last = more[2] ?? more[1]!;
  }

  // A period closing the range expression (`§501 to 516. REPEALED.`) belongs to
  // the range, not the title. The number pattern refuses to swallow it — that
  // is what keeps `516.` from being read as a decimal — so it is consumed here.
  const trailingStop = rest.slice(consumed).match(/^\s*\./);
  if (trailingStop) consumed += trailingStop[0]!.length;

  return {
    covers: { start, end: expandRangeEnd(start, last), raw: rest.slice(0, consumed).trim() },
    title: rest.slice(consumed).trim(),
  };
}
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
function splitBlocks(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<Element>,
  prefix: string
): Block[] {
  const blocks: Block[] = [{ kind: "body", heading: null, paragraphs: [], elements: [] }];
  // Whether a blank paragraph (or a heading) has gone by since the last text.
  // Blanks are dropped from the blocks, but the constitutions use them as the
  // separator between one centred item and the next — see the catchline join
  // below — so the fact of one is remembered here.
  let separated = true;

  root.find("p").each((_, el) => {
    const classes = ($(el).attr("class") ?? "").split(/\s+/);
    const text = clean($(el).text());

    if (classes.includes("XNotesHeading")) {
      if (text) {
        blocks.push({ kind: "annotation", heading: text, paragraphs: [], elements: [] });
      }
      separated = true;
      return;
    }
    if (!text) {
      separated = true;
      return;
    }

    let block = blocks[blocks.length - 1]!;

    // An annotation can precede the section: a PART banner, then a Note about
    // the part, then the section itself. A statute heading therefore reopens
    // the body rather than being swallowed by the annotation above it.
    if (
      block.kind === "annotation" &&
      !classes.includes("XNotes") &&
      isSectionHeading(leadingBoldText(textRuns(el)), prefix)
    ) {
      // A constitutional catchline sits directly above its heading, so when an
      // annotation intervenes — an article banner page carries the article
      // title, then a Law Journals note, then section 1 — the catchline is
      // stranded at the end of that annotation. Carry it into the body with the
      // heading it belongs to, or the section inherits the *article's* title.
      const carried: { text: string; element: Element }[] = [];
      const last = block.paragraphs[block.paragraphs.length - 1];
      if (prefix !== "HRS" && catchlineAbove(last)) {
        carried.push({ text: block.paragraphs.pop()!, element: block.elements.pop()! });
      }
      block = {
        kind: "body",
        heading: null,
        paragraphs: carried.map((c) => c.text),
        elements: carried.map((c) => c.element),
      };
      blocks.push(block);
    }

    // A constitutional catchline that runs to a second line is printed as two
    // consecutive centred paragraphs with nothing between them — `EXECUTIVE AND
    // ADMINISTRATIVE OFFICES` / `AND DEPARTMENTS`. Taking only the last line
    // titled 10 sections with a fragment. A blank paragraph is what separates
    // one centred item from the next, so its absence is what makes the second
    // line a continuation rather than, say, the section catchline following
    // the article's title. Joined here, where the blank is still visible; the
    // continuation's element is dropped so `paragraphs` and `elements` stay
    // index-aligned, which costs nothing — a continuation is never a heading.
    const previous = block.elements[block.elements.length - 1];
    if (
      prefix !== "HRS" &&
      !separated &&
      previous &&
      $(el).attr("align") === "center" &&
      $(previous).attr("align") === "center" &&
      catchlineAbove(text) &&
      catchlineAbove(block.paragraphs[block.paragraphs.length - 1])
    ) {
      block.paragraphs[block.paragraphs.length - 1] += ` ${text}`;
      return;
    }

    block.paragraphs.push(text);
    block.elements.push(el);
    separated = false;
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

  const { prefix, suffix } = normalizeFilename(filename);
  const blocks = splitBlocks($, root, prefix);
  const bodyBlocks = blocks.filter((block) => block.kind === "body");
  const body = {
    paragraphs: bodyBlocks.flatMap((block) => block.paragraphs),
    elements: bodyBlocks.flatMap((block) => block.elements),
  };
  const annotations: Annotation[] = blocks
    .filter((block) => block.kind === "annotation")
    .map((block) => ({ heading: block.heading!, text: block.paragraphs.join("\n") }));

  // --- section number and title, taken from the page where possible ---
  const fromFilename = filenameToSectionNumber(filename);

  /** Build a full section number from a bare one parsed out of the page. */
  const pageNumber = (raw: string): string =>
    prefix === "HRS" ? `§${raw}${suffix}` : `${prefix} §${raw}${suffix}`;

  let sectionNumber = fromFilename;
  let numberSource: ParsedSection["numberSource"] = "filename";
  let title = "";
  let headingIsSupplied = false;
  let titleIsSupplied = false;
  let covers: SectionRange | null = null;
  let partHeading: string | null = null;

  // Every heading on the page, in document order. A page can carry more than
  // one: a repealed-range banner for an [OLD] part, then the section the file
  // is actually for.
  const candidates: {
    index: number;
    heading: string;
    number: string;
    rest: string;
    /** The constitutions put the catchline in the paragraph above the heading. */
    titleAbove?: boolean;
  }[] = [];
  body.elements.forEach((el, index) => {
    const heading = leadingBoldText(textRuns(el));
    if (heading === "") return;
    const match = heading.match(HEADING_RE);
    if (match) {
      candidates.push({
        index,
        heading,
        number: pageNumber(match[1]!),
        rest: match[2]!.trim(),
      });
      return;
    }
    // The alternative forms are tried only for the non-HRS documents, so the
    // 22,972 HRS sections keep exactly the behaviour they had.
    if (prefix === "HRS") return;

    const act = heading.match(ACT_HEADING_RE);
    if (act) {
      candidates.push({ index, heading, number: pageNumber(act[1]!), rest: act[2]!.trim() });
      return;
    }
    const constitutional = heading.match(CONST_HEADING_RE);
    if (constitutional) {
      // The page states the section but not its article, so the filename still
      // decides the number — the same split a range heading forces.
      candidates.push({
        index,
        heading,
        number: fromFilename,
        rest: constitutional[2]!.trim(),
        titleAbove: true,
      });
    }
  });

  // Prefer the heading that agrees with the filename; fall back to the first.
  // Without this, `HRS_0327-0031.htm` takes the §327-21 banner above it and two
  // different files end up claiming the same section number.
  const chosen = candidates.find((c) => c.number === fromFilename) ?? candidates[0];
  const headingIndex = chosen?.index ?? -1;

  if (chosen) {
    const range = parseRangeTitle(chosen.rest, chosen.number);
    if (range) {
      // A range heading confirms the section exists but does not say which of
      // the range's members this file is — several filenames point at one range
      // page, and the file is not always the start. The filename decides.
      sectionNumber = fromFilename;
      numberSource = "page-range";
      covers = range.covers;
      title = range.title;
    } else {
      sectionNumber = chosen.number;
      // A constitutional heading states the section but not its article, so the
      // number still comes from the filename and `numberSource` says so.
      numberSource = chosen.titleAbove ? "filename" : "page";
      title = chosen.rest;
    }

    // The constitutions carry their catchline above the heading rather than on
    // it, so the title comes from there when the heading itself yielded none.
    if (chosen.titleAbove && !title) {
      const above = catchlineAbove(body.paragraphs[chosen.index - 1]);
      if (above) {
        title = above;
        // Lifted out of the body, not copied — otherwise it renders twice, the
        // same mistake the PART banner made.
        body.paragraphs[chosen.index - 1] = "";
      }
    }

    headingIsSupplied = chosen.heading.startsWith("[");

    // `[§440G-16 Rules.]` brackets the whole heading; HEADING_RE consumes the
    // opening bracket with the number, leaving the closing one on the title.
    if (headingIsSupplied && title.endsWith("]")) title = title.slice(0, -1).trim();

    // `§604-13  [Arrest under warrant.]` brackets only the title, which marks a
    // catchline supplied editorially rather than enacted.
    const supplied = title.match(/^\[([^\[\]]+)\]$/);
    if (!headingIsSupplied && supplied) {
      title = supplied[1]!.trim();
      titleIsSupplied = true;
    }

    // Drop the heading from the body so bodyText starts at the statute text.
    const paragraph = body.paragraphs[headingIndex]!;
    body.paragraphs[headingIndex] = paragraph.startsWith(chosen.heading)
      ? paragraph.slice(chosen.heading.length).trim()
      : paragraph;
  }

  // A PART/ARTICLE banner sits above the section heading when one is present.
  // With no heading at all, the opening paragraph is itself the banner.
  const bannerEnd = headingIndex === -1 ? 1 : headingIndex;
  for (let i = 0; i < Math.min(bannerEnd, body.paragraphs.length); i++) {
    const paragraph = body.paragraphs[i]!;
    if (!STRUCTURAL_RE.test(paragraph)) continue;
    partHeading = paragraph;
    // The banner is *moved* into `partHeading`, not copied. That field exists so
    // the banner can be presented as structure; leaving it in the body as well
    // renders it twice, which it was doing on 1,243 of the 1,247 sections that
    // carried one.
    body.paragraphs[i] = "";

    // The constitutions name the article on the line below its banner —
    // `ARTICLE I` then `BILL OF RIGHTS`. That is the article's title, not the
    // section's, so it joins the banner instead of opening the statute text.
    // The section's own catchline has already been lifted out above, so
    // whatever remains here belongs to the article.
    if (prefix !== "HRS") {
      const articleTitle = catchlineAbove(body.paragraphs[i + 1]);
      if (articleTitle) {
        partHeading = `${paragraph} — ${articleTitle}`;
        body.paragraphs[i + 1] = "";
      }
    }
    break;
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

  // Repeals show up four ways: in the title, as a body opening with
  // "Repealed", as a body that is nothing but a bracketed repeal note, or as a
  // body opening with the numbers of a run of sections repealed together —
  // `§§15-7, 15-8 REPEALED. L 2019, c 136, §§54, 55.` — which is how 38
  // sections in the corpus are written. Found by `bun run coverage`.
  const isRepealed =
    /\brepealed\b/i.test(title) ||
    /^\s*\[?\s*repealed\b/i.test(bodyText) ||
    /^\s*\[[^\]]*\brepealed\b[^\]]*\]\s*$/i.test(bodyText) ||
    /^\s*\[?§§?[\d\w:.\-]+(?:(?:,| to| and) ?[\d\w:.\-]+)*\s+repealed\b/i.test(bodyText);

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
    headingIsSupplied,
    isRepealed,
    covers,
    titleIsSupplied,
    // Populated from the reviewed ledger after parsing, never inferred here.
    // See src/corrections.ts and docs/source-anomalies.md.
    sourceAnomalies: [],
    numberSource,
    filename,
    url,
  };
}

interface IndexEntry {
  text: string;
  classes: string[];
}

/**
 * The paragraphs of an index page, in order. Class is carried alongside the
 * text because the annotation vocabulary (`XNotesHeading` / `XNotes`) is what
 * separates notes from a listing, exactly as it does on a section page.
 */
function indexEntries(html: string): IndexEntry[] {
  const $ = cheerio.load(html);
  $("script, style, #pageLinks").remove();
  const section = $("div.WordSection1");
  const root = section.length ? section : $("body");
  return root
    .find("p")
    .map((_, el) => ({
      text: clean($(el).text()),
      classes: ($(el).attr("class") ?? "").split(/\s+/),
    }))
    .get()
    .filter((entry) => entry.text);
}

/**
 * The `CHAPTER n` line. Bracketed on uncodified chapters, exactly as section
 * headings are — `[CHAPTER 30]` — and a variant puts the title inside the
 * bracket too: `[CHAPTER 56 PUBLIC OFF-STREET PARKING FACILITIES]`.
 */
const BANNER = /^\[?\s*chapter\s+([0-9][0-9A-Za-z]*)\s*(.*?)\s*\]?$/i;

/**
 * Where the chapter begins. Everything before it belongs to the title above.
 *
 * A superseded banner can precede the live one — `CHAPTER 14 [OLD]` then
 * `CHAPTER 14 [NEW]` — exactly as `[OLD]` part banners precede section headings.
 * Taking the first match makes "ABSENTEE VOTING" the title of the
 * presidential-elections chapter.
 */
function chapterBannerIndex(paragraphs: string[]): number {
  const inlineOf = (p: string) => p.match(BANNER)?.[2]?.trim() ?? "";
  const banners = paragraphs
    .map((p, i) => (BANNER.test(p) ? i : -1))
    .filter((i) => i !== -1);
  return banners.find((i) => !/^\[?old\]?$/i.test(inlineOf(paragraphs[i]!))) ?? banners[0] ?? -1;
}

/**
 * The section listing on a chapter index page: the rows under the `Section`
 * column header, each a number and a title, wrapping into the next paragraph
 * like every other listing on these pages. PART/ARTICLE banners and notes
 * between rows are skipped.
 *
 * A row must start with the chapter's own number — `26-14.5 Repealed` for
 * chapter 26 — which is what tells a row from a wrapped title line that
 * happens to begin with digits (`6:00 p.m. and 6:00 a.m.; definition;`).
 * Empty for the 292 chapters whose page is only a repeal note.
 */
export function parseSectionListing(
  html: string,
  chapterNumber: string
): { number: string; title: string }[] {
  const entries = indexEntries(html);
  const paragraphs = entries.map((e) => e.text);
  const start = chapterBannerIndex(paragraphs);
  if (start === -1) return [];
  const escaped = chapterNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ROW = new RegExp(String.raw`^\[?(${escaped}[-:][0-9A-Z:.\-]*[0-9A-Z])\]?\s+(.*)$`);
  const rows: { number: string; title: string }[] = [];
  let last: { number: string; title: string } | null = null;
  for (let i = start + 1; i < entries.length; i++) {
    const entry = entries[i]!;
    // Notes can sit between parts of a listing; a row is told by its shape,
    // not its class — chapter 39A's rows 287–289 are `oneParagraph`.
    if (entry.classes.some((c) => c === "XNotes" || c === "XNotesHeading")) {
      last = null;
      continue;
    }
    const m = entry.text.match(ROW);
    if (m) {
      last = { number: m[1]!, title: m[2]!.trim() };
      rows.push(last);
      continue;
    }
    // A banner, the `Section` header, or the chapter title: not a continuation.
    if (/^(section|part\b|article\b|\[?chapter\b)/i.test(entry.text) || entry.text === entry.text.toUpperCase()) {
      last = null;
      continue;
    }
    if (last) last.title = `${last.title} ${entry.text}`;
  }
  return rows;
}

/**
 * Read the DIVISION / TITLE banners and the title's table of contents from the
 * top of an index page, or null when the page has no TITLE banner — which is
 * all but 41 of them.
 *
 * The shape, from reading the 41: a `DIVISION n. NAME` paragraph on the first
 * title of each division; `TITLE n. NAME`, bracketed when revisor-supplied, the
 * name sometimes wrapping into the next paragraph (`TITLE 6. COUNTY
 * ORGANIZATION` / `AND ADMINISTRATION`); a `Chapter` column header; then one
 * row per chapter, also wrapping, with `Subtitle n. Name` rows on titles 6 and
 * 12. Notes may sit anywhere in that — title 37 carries its codification note
 * between the banner and the header. Everything stops at the `CHAPTER n` line,
 * which is where `parseChapterIndex` starts.
 */
export function parseTitleBanner(html: string): ParsedTitleBanner | null {
  const entries = indexEntries(html);
  // The first CHAPTER line of any kind, not the live one `parseChapterIndex`
  // picks: a superseded `CHAPTER 11 [OLD]` banner is still the chapter's, not
  // the title's, and title 2 has one right under its table of contents.
  const end = entries.findIndex((e) => BANNER.test(e.text));
  const head = end === -1 ? entries : entries.slice(0, end);

  const TITLE = /^(\[?)\s*TITLE\s+(\d+[A-Z]?)\.\s*(.*?)\s*\]?$/;
  const DIVISION = /^\[?\s*DIVISION\s+(\d+)\.\s*(.*?)\s*\]?$/;
  const SUBTITLE = /^Subtitle\s+(\d+)\.\s*(.*)$/;
  // A chapter number then its name. Title Case in the listing, which is how a
  // row is told from the uppercase banners above it.
  const ROW = /^(\d+[A-Z]*)\s+(\S.*)$/;

  const titleAt = head.findIndex((e) => TITLE.test(e.text));
  if (titleAt === -1) return null;
  const titleMatch = head[titleAt]!.text.match(TITLE)!;

  const isProse = (e: IndexEntry) => e.classes.includes("RegularParagraphs");
  const isNote = (e: IndexEntry) => e.classes.some((c) => c === "XNotes" || c === "XNotesHeading");

  // The banner's name runs on through the plain paragraphs that immediately
  // follow it, up to anything structural.
  const structural = (t: string) => /^Chapter$/.test(t) || SUBTITLE.test(t) || ROW.test(t);
  const nameParts = [titleMatch[3]!];
  for (let i = titleAt + 1; i < head.length && isProse(head[i]!) && !structural(head[i]!.text); i++) {
    nameParts.push(head[i]!.text);
  }
  const name = nameParts.join(" ").replace(/\]$/, "").trim();

  let division: ParsedTitleBanner["division"];
  const divisionEntry = head.find((e) => DIVISION.test(e.text));
  if (divisionEntry) {
    const m = divisionEntry.text.match(DIVISION)!;
    division = { number: Number(m[1]), name: m[2]! };
  }

  const listing: ParsedTitleBanner["listing"] = [];
  let group: ParsedTitleBanner["listing"][number] | null = null;
  /** Whatever a following plain paragraph would continue: the last row or subtitle. */
  let wrapping: { number: string; name: string } | { subtitle?: string; chapters: unknown[] } | null = null;
  let inListing = false;
  const notes: string[] = [];
  const annotations: Annotation[] = [];
  let open: Annotation | null = null;

  for (let i = titleAt + 1; i < head.length; i++) {
    const entry = head[i]!;
    if (entry.classes.includes("XNotesHeading")) {
      open = { heading: entry.text, text: "" };
      annotations.push(open);
      wrapping = null;
      inListing = false;
      continue;
    }
    if (entry.classes.includes("XNotes")) {
      if (open) open.text = open.text ? `${open.text}\n${entry.text}` : entry.text;
      else notes.push(entry.text);
      wrapping = null;
      inListing = false;
      continue;
    }
    open = null;
    if (!isProse(entry)) continue;
    if (/^Chapter$/.test(entry.text)) {
      inListing = true;
      continue;
    }
    const sub = entry.text.match(SUBTITLE);
    if (sub) {
      group = { subtitle: `Subtitle ${sub[1]}. ${sub[2]!.trim()}`, chapters: [] };
      listing.push(group);
      inListing = true;
      wrapping = group;
      continue;
    }
    const m = entry.text.match(ROW);
    if (m && inListing) {
      if (!group) {
        group = { chapters: [] };
        listing.push(group);
      }
      const row = { number: m[1]!, name: m[2]!.trim() };
      group.chapters.push(row);
      wrapping = row;
      continue;
    }
    // Titles 37 and 38 close their tables with an appendix listing, which is
    // not a chapter and not the last row's name.
    if (/^appendix\b/i.test(entry.text)) {
      wrapping = null;
      inListing = false;
      continue;
    }
    // A plain paragraph straight after a row or subtitle is the rest of its
    // name (`47C Indebtedness of the Counties, Exclusions from` / `the Funded
    // Debt, and Certification Thereof`; `Subtitle 4. Forestry and Wildlife;
    // Recreation Areas;` / `Fire Protection`). After anything else it is noise
    // — a stray heading between the banner and the `Chapter` header.
    if (wrapping && "name" in wrapping) wrapping.name = `${wrapping.name} ${entry.text}`;
    else if (wrapping) wrapping.subtitle = `${wrapping.subtitle} ${entry.text}`;
  }

  return {
    ...(division ? { division } : {}),
    number: titleMatch[2]!,
    name,
    supplied: titleMatch[1] === "[",
    listing: listing.filter((g) => g.chapters.length),
    notes: notes.join("\n\n"),
    annotations: annotations.filter((a) => a.text),
  };
}

/**
 * The chapter's own notes and annotation blocks.
 *
 * Scope is everything after the live `CHAPTER n` banner — see
 * `ParsedChapterIndex` for why the boundary matters. Prose stops at the section
 * listing; annotation blocks are read with the same `XNotesHeading` / `XNotes`
 * vocabulary as section pages, and a block is continued only by an `XNotes`
 * paragraph. That last rule is what keeps a Cross References block on a long
 * index page from swallowing the 2,000-paragraph listing behind it.
 */
function chapterContent(
  entries: IndexEntry[],
  bannerIndex: number,
  titleIndex: number,
  chapterNumber: string
): { notes: string; annotations: Annotation[] } {
  if (bannerIndex === -1) return { notes: "", annotations: [] };

  // What opens the section listing: the `Section` column header, a PART or
  // ARTICLE banner, or a listing line itself (`431:1-100 Short title`).
  const LISTING = new RegExp(
    String.raw`^section$|^(?:part|article)\b|^\[?${chapterNumber}[-:]`,
    "i"
  );

  const notes: string[] = [];
  const annotations: Annotation[] = [];
  let open: { heading: string; paragraphs: string[] } | null = null;
  let inListing = false;

  for (let i = bannerIndex + 1; i < entries.length; i++) {
    const entry = entries[i]!;
    if (i === titleIndex) continue;

    if (entry.classes.includes("XNotesHeading")) {
      open = { heading: entry.text, paragraphs: [] };
      annotations.push({ heading: entry.text, text: "" });
      continue;
    }
    if (open) {
      if (entry.classes.includes("XNotes")) {
        open.paragraphs.push(entry.text);
        annotations[annotations.length - 1]!.text = open.paragraphs.join("\n");
        continue;
      }
      open = null;
    }
    if (inListing) continue;
    if (LISTING.test(entry.text)) {
      inListing = true;
      continue;
    }
    notes.push(entry.text);
  }

  return {
    notes: notes.join("\n\n"),
    annotations: annotations.filter((a) => a.text),
  };
}

/**
 * Parse a chapter index page for the chapter's title, notes and annotations.
 *
 * Index pages open with `CHAPTER <number>` followed by the title, though some
 * are preceded by division/title banners and a table of contents for the whole
 * title, so the `CHAPTER` line is located rather than assumed to be first.
 *
 * Everything after that banner belongs to the chapter; everything before it
 * belongs to the division/title above it or to a superseded `[OLD]` banner.
 * That boundary is what makes `notes` and `annotations` attributable — see
 * `ParsedChapterIndex`.
 */
export function parseChapterIndex(
  html: string,
  filename: string,
  url: string,
  chapterNumber?: string
): ParsedChapterIndex {
  const entries = indexEntries(html);
  const paragraphs = entries.map((entry) => entry.text);

  let title = "";
  /** Index of the paragraph the title was taken from, so notes can skip it. */
  let titleIndex = -1;
  const inlineOf = (p: string) => p.match(BANNER)?.[2]?.trim() ?? "";
  // `[OLD]` / `[NEW]` are status markers, not titles: a banner carrying one has
  // its title in the following paragraph like any unmarked banner.
  const MARKER = /^\[?(old|new)\]?$/i;
  const chapterIndex = chapterBannerIndex(paragraphs);
  if (chapterIndex !== -1) {
    const inline = inlineOf(paragraphs[chapterIndex]!);
    if (inline && !MARKER.test(inline)) title = inline;
    else {
      // Otherwise the title is the next paragraph that is neither the "Section"
      // column header nor a repeat of the banner nor the start of the listing.
      const offset = paragraphs
        .slice(chapterIndex + 1)
        .findIndex((p) => !/^section$/i.test(p) && !BANNER.test(p));
      const next = offset === -1 ? undefined : paragraphs[chapterIndex + 1 + offset];
      // Reject only a line that opens the section listing (`138-1 Definitions`),
      // not any line starting with a digit — chapter titles can begin with one
      // ("911 SERVICES", "340B Drug Discount Program").
      const listing = new RegExp(String.raw`^\[?${paragraphs[chapterIndex]!.match(BANNER)![1]}-`, "i");
      if (next && !listing.test(next)) {
        title = next;
        titleIndex = chapterIndex + 1 + offset;
      }
    }
  }
  title = title.replace(/^\[/, "").replace(/\]$/, "").trim();

  const bannerNumber =
    chapterIndex === -1 ? "" : paragraphs[chapterIndex]!.match(BANNER)![1]!;
  const { notes, annotations } = chapterContent(
    entries,
    chapterIndex,
    titleIndex,
    bannerNumber
  );

  return {
    chapterNumber: chapterNumber ?? extractChapterFromFilename(filename),
    title,
    notes,
    annotations,
    filename,
    url,
  };
}
