/**
 * Citations into the non-HRS documents.
 *
 * Volume 1 carries six documents that are not numbered HRS chapters — both
 * constitutions, the Organic Act, the Admission Act, the Hawaiian Homes
 * Commission Act and the Hawaii National Park Act. HRS text names them 306
 * times and none of those references could be linked.
 *
 * **Why this is safe, when merging the namespaces would not be.** 89 non-HRS
 * numbers collide outright with HRS numbers — `1-2` is both HRS §1-2 and
 * CONST §1-2 — and 149 are bare. Putting them in one index is how `section 2`
 * acquires a confident link to the Admission Act. But the corpus never cites
 * these documents without naming them:
 *
 * ```
 * article I, §5 of the Hawaii constitution
 * Article V, section 6 of the Constitution of the State
 * section 203 of the Hawaiian Homes Commission Act, 1920, as amended
 * §4 of the Admission Act        Organic Act §73
 * Sixth Amendment to U.S. Constitution
 * ```
 *
 * So the document name is *part of the citation key*. Resolution requires it,
 * the indexes stay separate, and a bare `section 2` resolves to nothing here —
 * exactly as before. This is the same resolve-don't-match rule the HRS linker
 * uses, applied one level up.
 */
import type { ParsedSection, DocType } from "./config";
import { sectionHref } from "./resolver";
import type { Target } from "./resolver";

/** How each document is named in running text. */
const DOCUMENT_NAMES: [DocType, RegExp][] = [
  // The US Constitution is matched before Hawaii's: "Constitution of the United
  // States" would otherwise be claimed by a looser Hawaii pattern.
  [
    "uscon",
    /\b(?:United States Constitution|Constitution of the United States|U\.\s?S\.\s?Const(?:itution|\.)|federal constitution)/i,
  ],
  [
    "const",
    /\b(?:Hawaii|Hawai[‘']i|State)\s+[Cc]onstitution|\b[Cc]onstitution of (?:the State|Hawaii)(?:\s+of Hawaii)?|\bstate constitution|\bHaw\.\s?Const\./i,
  ],
  ["org", /\b(?:Hawaiian\s+)?Organic Act\b/i],
  ["adm", /\bAdmission Act\b/i],
  ["hhca", /\bHawaiian Homes Commission Act\b/i],
  ["hnp", /\bHawaii National Park\b/i],
];

/** Documents whose sections are numbered within an article. */
const ARTICLED: DocType[] = ["const", "uscon"];

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
  xix: 19, xx: 20, xxi: 21, xxii: 22, xxiii: 23, xxiv: 24, xxv: 25, xxvi: 26,
  xxvii: 27,
};

/** Amendments are cited by ordinal word far more often than by numeral. */
const ORDINAL: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, "twenty-first": 21,
  "twenty-second": 22, "twenty-third": 23, "twenty-fourth": 24,
  "twenty-fifth": 25, "twenty-sixth": 26, "twenty-seventh": 27,
};

const numberOf = (token: string): number | null => {
  const t = token.toLowerCase().replace(/\s+/g, "-");
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return ROMAN[t] ?? ORDINAL[t] ?? null;
};

const ARTICLE_TOKEN = String.raw`\d+|[ivxlcdm]+`;
const ORDINAL_TOKEN = Object.keys(ORDINAL).join("|");
// The trailing guard is not optional. Without it `see §171-64.7` inside an
// Organic Act sentence matched as `§17` and linked to Organic Act §17 — a
// confidently wrong link of exactly the kind this project exists to prevent.
// A number followed by a hyphen, colon or further digits is an HRS citation,
// not a flat section of one of these documents.
const SECTION_TOKEN = String.raw`\d+(?:\.\d+)?[A-Za-z]?(?![\d\-:])`;

/** `article XII, §§1 and 3` / `Article V, section 6` — the articled documents. */
const ARTICLE_SECTION = new RegExp(
  String.raw`\b(?:art(?:icle|\.)\s*(?<article>${ARTICLE_TOKEN}))` +
    String.raw`(?:\s*,?\s*(?:§§?|sections?)\s*(?<section>${SECTION_TOKEN}))?`,
  "gi"
);
/** `section 203` / `§5(f)` / `§73(c)` — the flat documents. */
const FLAT_SECTION = new RegExp(
  String.raw`(?:§§?|\bsections?)\s*(?<section>${SECTION_TOKEN})`,
  "gi"
);
/** `Sixth Amendment` / `amendment XIV` / `25th amendment`. */
const AMENDMENT = new RegExp(
  String.raw`\b(?:(?<word>${ORDINAL_TOKEN})\s+amendment|amendment\s+(?<num>${ARTICLE_TOKEN}))`,
  "gi"
);

/**
 * How far from the document's name a number may sit and still belong to it.
 *
 * Long enough for `article XII, §§1 and 3 of the Hawaii constitution`.
 */
const WINDOW = 60;

/**
 * Trim a window at the nearest sentence boundary.
 *
 * Distance alone is not enough. `Generally, see notes to Organic Act §73.
 * Legislative approval of sale or gift of lands, see §171-64.7.` puts an
 * unrelated HRS citation 55 characters after "Organic Act" — inside the window,
 * but in the next sentence. A citation belongs to the sentence that names its
 * document, so the window stops there. Erring short costs a link; erring long
 * costs a wrong one.
 */
const SENTENCE = /(?<=\.)\s+(?=[A-Z])/;

/**
 * A citation bound to the document named immediately after it.
 *
 * `Article I, Section 10, of the Constitution of the State of Hawaii` — the
 * "of the" construction is how legal writing attaches a provision to its
 * source, and it beats raw proximity. In that example "U.S. Constitution" sits
 * 8 characters before the article and "Constitution of the State of Hawaii" 9
 * after, so the nearest name is the wrong one; the binding phrase is not.
 */
const BINDING = /^[\s,]*(?:of\s+)?(?:the\s+)?$/;

/**
 * A semicolon ends a citation's reach.
 *
 * Legal writing lists citations separated by semicolons — `U.S. Const., 5th
 * Am.; Const. art. I, §10` is two citations to two different documents, and
 * letting the first name reach across the semicolon attaches the second to it.
 */
const CLAUSE_BREAK = /;/;

function trimAfter(text: string): string {
  return text.split(SENTENCE)[0] ?? text;
}

function trimBefore(text: string): { text: string; offset: number } {
  const parts = text.split(SENTENCE);
  const last = parts[parts.length - 1] ?? text;
  return { text: last, offset: text.length - last.length };
}

export interface CrossIndex {
  /** docType -> citation key -> target. Kept apart from the HRS index. */
  documents: Map<DocType, Map<string, Target>>;
}

/** Display citation for a non-HRS section, in the form lawyers actually write. */
export function properCitation(section: ParsedSection): string {
  const bare = section.sectionNumber.replace(/^[A-Z]+ §/, "");
  const roman = (n: number) =>
    Object.keys(ROMAN).find((r) => ROMAN[r] === n)?.toUpperCase() ?? String(n);

  switch (section.docType) {
    case "const":
    case "uscon": {
      const prefix = section.docType === "const" ? "Haw. Const." : "U.S. Const.";
      const amendment = bare.match(/^AM-(\d+)(?:-(.+))?$/);
      if (amendment) {
        const tail = amendment[2] ? `, §${amendment[2]}` : "";
        return `${prefix} amend. ${roman(parseInt(amendment[1]!, 10))}${tail}`;
      }
      const parts = bare.match(/^(\d+)-(.+)$/);
      if (parts) return `${prefix} art. ${roman(parseInt(parts[1]!, 10))}, §${parts[2]}`;
      return `${prefix} art. ${roman(parseInt(bare, 10))}`;
    }
    case "org":
      return `Organic Act §${bare}`;
    case "adm":
      return `Admission Act §${bare}`;
    case "hhca":
      return `HHCA §${bare}`;
    case "hnp":
      return `Hawaii National Park Act §${bare}`;
    default:
      return section.sectionNumber;
  }
}

/** Build the cross-document index from the parsed corpus. */
export function buildCrossIndex(corpus: ParsedSection[]): CrossIndex {
  const documents = new Map<DocType, Map<string, Target>>();
  for (const section of corpus) {
    if (section.docType === "hrs") continue;
    const key = section.sectionNumber.replace(/^[A-Z]+ §/, "").toUpperCase();
    const map =
      documents.get(section.docType) ??
      documents.set(section.docType, new Map()).get(section.docType)!;
    map.set(key, {
      // Identity, so graph keys and page lookups agree with the HRS side; the
      // citation form is the label.
      number: section.sectionNumber,
      label: properCitation(section),
      kind: "section",
      title: section.title,
      href: sectionHref(section.sectionNumber),
    });
  }
  return { documents };
}

export interface CrossCitation {
  start: number;
  end: number;
  text: string;
  target: Target;
}

/**
 * Find citations into the non-HRS documents and resolve them.
 *
 * Only spans that carry both a document name and a number that resolves become
 * citations. A document named with no number at all is left alone: "the Hawaii
 * State Constitution" is prose, not a reference to a particular provision.
 */
export function detectCrossDocument(text: string, index: CrossIndex): CrossCitation[] {
  // Every place a document is named.
  const names: { docType: DocType; start: number; end: number }[] = [];
  for (const [docType, pattern] of DOCUMENT_NAMES) {
    if (!index.documents.has(docType)) continue;
    for (const m of text.matchAll(new RegExp(pattern.source, "gi"))) {
      names.push({ docType, start: m.index!, end: m.index! + m[0].length });
    }
  }
  if (!names.length) return [];

  // Every number that could be a citation into one of them. What key it yields
  // depends on which document it turns out to belong to, so that is deferred.
  type Candidate = { start: number; end: number; key: (doc: DocType) => string | null };
  const candidates: Candidate[] = [];

  for (const m of text.matchAll(new RegExp(AMENDMENT.source, "gi"))) {
    const n = numberOf(m.groups!.word ?? m.groups!.num ?? "");
    if (!n) continue;
    candidates.push({
      start: m.index!,
      end: m.index! + m[0].length,
      key: (doc) => (ARTICLED.includes(doc) ? `AM-${n}` : null),
    });
  }
  for (const m of text.matchAll(new RegExp(ARTICLE_SECTION.source, "gi"))) {
    const article = numberOf(m.groups!.article ?? "");
    if (!article) continue;
    const section = m.groups!.section;
    candidates.push({
      start: m.index!,
      end: m.index! + m[0].length,
      key: (doc) =>
        ARTICLED.includes(doc) ? (section ? `${article}-${section}` : String(article)) : null,
    });
  }
  for (const m of text.matchAll(new RegExp(FLAT_SECTION.source, "gi"))) {
    const section = m.groups!.section!;
    candidates.push({
      start: m.index!,
      end: m.index! + m[0].length,
      key: (doc) => (ARTICLED.includes(doc) ? null : section),
    });
  }

  // Longest first, so `article I, §5` claims its span before the bare `§5`
  // inside it can.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);

  const found: CrossCitation[] = [];
  const taken: [number, number][] = [];

  for (const candidate of candidates) {
    if (taken.some(([a, b]) => candidate.start < b && candidate.end > a)) continue;

    // The nearest named document wins, not the first one in the text.
    //
    // `...secured by the Fifth Amendment to the U.S. Constitution and by
    // Article I, Section 10, of the Constitution of the State of Hawaii` names
    // both. Scanning outward from each name in turn gave `Article I, Section 10`
    // to the U.S. Constitution, because that name came first — a confidently
    // wrong link. The article is 4 characters from "Constitution of the State
    // of Hawaii" and 60 from "U.S. Constitution", so proximity settles it.
    let best: { docType: DocType; gap: number; bound: boolean } | null = null;
    for (const name of names) {
      const follows = name.start >= candidate.end;
      const gap = follows
        ? name.start - candidate.end
        : candidate.start >= name.end
          ? candidate.start - name.end
          : 0;
      if (gap > WINDOW) continue;
      // A citation belongs to the sentence, and the clause, that names its
      // document.
      const between = follows
        ? text.slice(candidate.end, name.start)
        : text.slice(name.end, candidate.start);
      if (SENTENCE.test(between) || CLAUSE_BREAK.test(between)) continue;
      if (!candidate.key(name.docType)) continue;

      const bound = follows && BINDING.test(between);
      // A binding phrase wins outright; otherwise the nearest name does.
      if (!best || (bound && !best.bound) || (bound === best.bound && gap < best.gap)) {
        best = { docType: name.docType, gap, bound };
      }
    }
    if (!best) continue;

    const key = candidate.key(best.docType)!;
    const target = index.documents.get(best.docType)?.get(key.toUpperCase());
    if (!target) continue;

    taken.push([candidate.start, candidate.end]);
    found.push({
      start: candidate.start,
      end: candidate.end,
      text: text.slice(candidate.start, candidate.end),
      target,
    });
  }

  return found.sort((a, b) => a.start - b.start);
}
