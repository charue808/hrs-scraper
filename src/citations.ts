/**
 * Citation detection.
 *
 * Detect generously, resolve against the real inventory, link only what
 * resolved. Every guard here corresponds to a numbered hazard in
 * `docs/citation-linking.md`, measured against the full corpus.
 */
import { resolve, type Index, type Target } from "./resolver";

/** Why a candidate was not linked. Tracked as the quality metric. */
export type RejectReason =
  | "bare-number" // no chapter-section hyphen: never an HRS section (hazard 2)
  | "foreign-law" // adjacent to U.S.C. / IRC / a named federal Act (hazard 2)
  | "admin-rules" // a third component: Hawaii Administrative Rules (hazard 7)
  | "superseded" // H.R.S. / R.L.H. prefix: the pre-1972 code (hazard 8)
  /**
   * The chapter exists in the corpus but the section does not — the statute is
   * pointing at text that has been removed. Distinguished from `unresolved`
   * because it is the detector working correctly, not a grammar gap: 325 of the
   * 448 unresolved section references are this.
   *
   * Deliberately *not* called "repealed". That the section is absent from the
   * current code is verifiable; *why* it is absent is an inference we cannot
   * make per citation, and this project does not assert what it cannot show.
   */
  | "absent-section"
  | "unresolved"; // shaped right, but nothing in the corpus matches

export interface Citation {
  start: number;
  end: number;
  text: string; // exactly as written in the source
  number: string; // normalized, e.g. "26-34"
  kind: "section" | "chapter";
  target: Target | null;
  reason: RejectReason | null;
  /** True for the endpoints of `sections 11-1 to 11-9`. */
  rangeEndpoint: boolean;
}

// A section number. The decimal group requires a digit after the period, which
// is the whole of hazard 1: `section 6E-43.6` keeps its decimal, `section
// 11-97.` at the end of a sentence does not.
const NUMBER = String.raw`\d+[A-Z]?(?::\d+[A-Z]?)?-\d+[A-Z]?(?:\.\d+)*`;
const BARE = String.raw`\d+[A-Z]?`;

// Requiring a digit after the keyword excludes "this section", "this chapter"
// and "this part" for free — 27,685 occurrences, the largest category in the
// corpus (hazard 3).
const CITE = new RegExp(
  String.raw`(?<kw>sections?|chapters?|§§?)\s*(?<num>${NUMBER}|${BARE})`,
  "gi"
);

// Continues an elided list after a plural keyword: "sections 92-3, 92-7, and
// 92-9" (hazard 4). `to` is included so both endpoints of a range are linked —
// the range is not expanded to the sections in between.
const MORE = new RegExp(
  String.raw`^(?:\s*,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+|(?<range>\s+to\s+))(?:§+\s*)?(?<num>${NUMBER}|${BARE})`,
  "i"
);

const FOREIGN_NAME = String.raw`United States Code|U\.S\.C\.|C\.F\.R\.|Code of Federal Regulations|Internal Revenue Code|Social Security Act|Public Law|P\.L\.|Hawaii Administrative Rules|Stat\.`;
// "42 United States Code chapter 103" — the marker precedes the keyword.
const FOREIGN_BEFORE = new RegExp(String.raw`(?:${FOREIGN_NAME})[\s,]*$`, "i");
// "chapter 11 of the Internal Revenue Code", "section 106 of the National
// Historic Preservation Act", "Chapter 13 of Title 12 of the United States Code"
const FOREIGN_AFTER = new RegExp(
  String.raw`^[\s,]*(?:(?:or|and)\s+\d+[A-Z]?[\s,]*)*(?:of\s+)?(?:subtitle\s+\w+[\s,]*)?of\s+(?:the\s+)?(?:Title\s+\d+|${FOREIGN_NAME}|[A-Z][A-Za-z'’ ]{2,45}?(?:Act|Code))\b` +
    String.raw`|^[\s,]*(?:subchapter|subtitle)\b`,
  "i"
);

// Hawaii Administrative Rules are title-chapter-section, so their first two
// components are character-identical to an HRS chapter-section number:
// `§13-300-51` would otherwise link to HRS §13-300 (hazard 7).
const ADMIN_RULES_TAIL = /^-\d/;
// Inside an annotation, `H.R.S. §711-77` refers to the pre-1972 compilation,
// not to today's §711-77 (hazard 8). The corpus also writes the marker with a
// year in between — `RLH 1955, §57-43` — so a year and punctuation may separate
// the two. Bare `HRS` (no periods) is deliberately excluded: unlike the
// punctuated forms it is also how the current compilation is written.
const SUPERSEDED_BEFORE =
  /(?:H\.R\.S\.|R\.L\.H\.|\bRLH\b|Revised Laws of Hawaii)\s*(?:\d{4})?[\s,;§]*$/i;
// `Id.` is the legal back-reference idiom: "the same source as the previous
// citation". Commentary uses it in runs — `1. H.R.S. §703-1.  2. Id. §703-2.
// 3. Id. §577-12.` — so the compilation marker sits sentences away and the
// adjacency check above cannot see it. Left alone these resolve against today's
// index and point at real sections that say something else, which is the exact
// wrong-link failure this design exists to prevent (20 such links in the corpus).
const ID_BEFORE = /\bId\.\s*(?:at\s+)?§*\s*$/i;
const SUPERSEDED_ANYWHERE = /H\.R\.S\.|R\.L\.H\.|\bRLH\b|Revised Laws of Hawaii/i;

export interface DetectOptions {
  /**
   * Annotation text cites the superseded compilation and Hawaii Administrative
   * Rules far more often than statute text does. Both guards apply everywhere;
   * this only controls how aggressively the superseded-prefix window is read.
   */
  annotation?: boolean;
}

/**
 * Find every citation in a string and resolve it.
 *
 * Candidates that are rejected are returned too, with `reason` set — the
 * rejects are the quality metric, and they are only useful if they are visible.
 */
export function detect(text: string, index: Index, options: DetectOptions = {}): Citation[] {
  const found: Citation[] = [];
  // Where the block first names the superseded compilation, so an `Id.`
  // back-reference can tell whether it is inheriting that context.
  const supersededFrom = text.search(SUPERSEDED_ANYWHERE);

  const classify = (
    number: string,
    kind: "section" | "chapter",
    start: number,
    end: number,
    rangeEndpoint: boolean
  ): Citation => {
    const before = text.slice(Math.max(0, start - 60), start);
    const after = text.slice(end, end + 70);
    const base = { start, end, text: text.slice(start, end), number, kind, rangeEndpoint };

    if (SUPERSEDED_BEFORE.test(before)) {
      return { ...base, target: null, reason: "superseded" };
    }
    // An `Id.` inherits the superseded context only when the block actually
    // established one earlier — otherwise it is an ordinary back-reference.
    if (ID_BEFORE.test(before) && supersededFrom !== -1 && supersededFrom < start) {
      return { ...base, target: null, reason: "superseded" };
    }
    if (ADMIN_RULES_TAIL.test(after)) {
      return { ...base, target: null, reason: "admin-rules" };
    }
    // HAR chapters are title-chapter (`HAR chapter 12-13`, `chapter 11-50,
    // Hawaii administrative rules`), which is character-identical to an HRS
    // section number. HRS chapter numbers never contain a hyphen, so a
    // hyphenated number after `chapter` is not an HRS chapter — and resolving it
    // as a *section* instead would be exactly the wrong link (hazard 7).
    if (kind === "chapter" && number.includes("-")) {
      return { ...base, target: null, reason: "admin-rules" };
    }
    // Proven against the full corpus: all 22,972 HRS section numbers contain a
    // hyphen, so a bare number is never an HRS section reference (hazard 2).
    if (kind === "section" && !number.includes("-")) {
      return { ...base, target: null, reason: "bare-number" };
    }
    // The foreign-law guard applies to chapter references only.
    //
    // Measured across the corpus: of 16,794 chapter-section references exactly
    // one sat next to a foreign-law marker, and it was a *correct* citation —
    // `section 490:1-201 of the Uniform Commercial Code`, because HRS chapter
    // 490 is Hawaii's UCC. Hawaii adopts uniform codes under their own names, so
    // a name-based guard misfires on them. A hyphenated section number is
    // already validated by the index, which is a stronger check than any name
    // heuristic; a federal citation of that shape (`1395i-3`, `9601-9675`)
    // simply fails to resolve. Bare chapter numbers have no such protection —
    // that is where all 38 real false positives were.
    if (kind === "chapter" && (FOREIGN_BEFORE.test(before) || FOREIGN_AFTER.test(after))) {
      return { ...base, target: null, reason: "foreign-law" };
    }

    const target = resolve(index, number, kind);
    if (target) return { ...base, target, reason: null };

    // Chapter present, section missing: the citation is well-formed and points
    // into the HRS, but the text it names is no longer in the code.
    const chapter = number.split(/[-:]/)[0]!;
    if (kind === "section" && index.chapters.has(chapter)) {
      return { ...base, target: null, reason: "absent-section" };
    }
    return { ...base, target: null, reason: "unresolved" };
  };

  for (const match of text.matchAll(CITE)) {
    const keyword = match.groups!.kw!.toLowerCase();
    const number = match.groups!.num!;
    const kind: "section" | "chapter" = keyword.startsWith("chapter") ? "chapter" : "section";
    const plural = keyword === "sections" || keyword === "chapters" || keyword === "§§";

    // The span starts at the keyword, so the link text is the whole citation —
    // `section 26-34`, not a bare `26-34`. Continuations below carry no keyword
    // and link the number alone.
    let cursor = match.index! + match[0].length;
    found.push(classify(number, kind, match.index!, cursor, false));

    if (!plural) continue;

    // Walk the list. It ends at the first token that is not citation-shaped.
    for (;;) {
      const more = text.slice(cursor).match(MORE);
      if (!more) break;
      const next = more.groups!.num!;
      const start = cursor + more[0].length - next.length;
      cursor += more[0].length;
      found.push(classify(next, kind, start, cursor, Boolean(more.groups!.range)));
    }
  }

  if (options.annotation) {
    // Nothing extra today; the guards above already apply. The flag exists so
    // callers declare the context and the behaviour can diverge without
    // changing every call site.
  }

  return found;
}

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPE[c]!);
}

/**
 * Render text with its resolved citations linked.
 *
 * Accessibility rules from `docs/citation-linking.md`: the link text is the
 * citation exactly as written, and the accessible name carries the target's
 * title so a screen-reader user scanning a link list does not meet a wall of
 * bare numbers. Unresolved candidates stay plain text — no dead links, no
 * `href="#"`.
 */
export function linkify(text: string, index: Index, options: DetectOptions = {}): string {
  const citations = detect(text, index, options).filter(
    (c) => c.target || c.reason === "absent-section"
  );
  let out = "";
  let at = 0;

  for (const citation of citations) {
    if (citation.start < at) continue; // overlapping match, keep the first
    out += escapeHtml(text.slice(at, citation.start));

    if (citation.target) {
      const label = citation.target.title
        ? `${citation.text}, ${citation.target.title.replace(/\.$/, "")}`
        : citation.text;
      out +=
        `<a href="${citation.target.href}" aria-label="${escapeHtml(label)}">` +
        `${escapeHtml(citation.text)}</a>`;
    } else {
      // Marked, not linked. The visible text is the statute's own and is not
      // altered; the clarification is additive for assistive technology, and a
      // non-color affordance carries it visually (WCAG 1.4.1).
      out +=
        `<span class="absent">${escapeHtml(citation.text)}` +
        `<span class="sr-only"> (not in the current code)</span></span>`;
    }
    at = citation.end;
  }

  return out + escapeHtml(text.slice(at));
}

/**
 * The section numbers a range covers, beyond its two endpoints.
 *
 * Rendering a range links only the endpoints, because `sections 11-1 to 11-9`
 * offers no text for §11-5 to attach to. But the statute means the whole span,
 * so the citation graph has to carry it: without this, a section cited only
 * inside a range looks uncited. 92.8% of the sections implied by ranges in this
 * corpus actually exist.
 *
 * Only same-chapter numeric spans are expanded — a range across chapters or
 * involving decimals is an interpretation rather than an enumeration.
 */
export function expandRange(citations: Citation[], index: Index): Target[] {
  const SIMPLE = /^(\d+[A-Z]?)-(\d+)$/;
  const extra: Target[] = [];

  for (let i = 1; i < citations.length; i++) {
    const end = citations[i]!;
    const start = citations[i - 1]!;
    if (!end.rangeEndpoint || end.kind !== "section") continue;

    const from = start.number.match(SIMPLE);
    const to = end.number.match(SIMPLE);
    if (!from || !to || from[1] !== to[1]) continue;

    for (let n = parseInt(from[2]!, 10) + 1; n < parseInt(to[2]!, 10); n++) {
      const target = index.sections.get(`${from[1]}-${n}`);
      if (target) extra.push(target);
    }
  }
  return extra;
}

/** Counts for the quality metric, keyed by reject reason. */
export function tally(citations: Citation[]): Record<string, number> {
  const counts: Record<string, number> = { linked: 0 };
  for (const citation of citations) {
    const key = citation.reason ?? "linked";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
