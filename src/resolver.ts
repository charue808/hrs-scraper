/**
 * The known-section index, and resolution against it.
 *
 * This is the stage that separates this implementation from a regex one: every
 * candidate citation is looked up against the real inventory before it becomes
 * a link. What resolves is linked; what does not stays plain text and is
 * counted. See `docs/citation-linking.md`.
 */
import { readdirSync } from "node:fs";
import {
  CHAPTERS_PATH,
  MANIFEST_PATH,
  PARSED_DIR,
  type Manifest,
  type ParsedSection,
} from "./config";
import { loadCorrections, sectionNumberAliases } from "./corrections";
import { buildCrossIndex, type CrossIndex } from "./cross-document";

export interface Target {
  /** Canonical section number, e.g. "§26-34", or chapter number, e.g. "91". */
  number: string;
  kind: "section" | "chapter";
  title: string;
  href: string;
  /**
   * How the target is written in a citation, when that differs from its
   * identity — `CONST §12-7` is keyed and linked by that identifier but cited as
   * `Haw. Const. art. XII, §7`. Absent for HRS sections, where the two are the
   * same string.
   */
  label?: string;
}

export interface Index {
  sections: Map<string, Target>;
  chapters: Map<string, Target>;
  /** `observed -> corrected`, from the reviewed corrections ledger. */
  aliases: Map<string, string>;
  /**
   * The non-HRS documents, kept deliberately separate.
   *
   * Merging them into `sections` is how `section 2` acquires a confident link to
   * the Admission Act — 89 of their numbers collide outright with HRS numbers.
   * They resolve only through a citation that names the document. See
   * `cross-document.ts`.
   */
  cross?: CrossIndex;
}

/**
 * URL slug for a section number.
 *
 * The colon of the article form becomes a hyphen (`431:1-100` -> `431-1-100`).
 * That cannot collide with an ordinary section number: those are chapter-section
 * with no hyphen inside either component, so a three-component slug is only ever
 * produced by the article form. `parser.test.ts` asserts this.
 */
export function sectionSlug(sectionNumber: string): string {
  return sectionNumber
    .replace(/^§/, "")
    .replace(/^([A-Z]+) §/, "$1-")
    .replace(/:/g, "-")
    .replace(/ \[OLD\]$/, "-old")
    .replace(/\s+/g, "");
}

export function sectionHref(sectionNumber: string): string {
  return `/hrs/${sectionSlug(sectionNumber)}`;
}

export function chapterHref(chapterNumber: string): string {
  return `/hrs/chapter/${chapterNumber}`;
}

export function volumeHref(volumeNumber: number): string {
  return `/hrs/volume/${volumeNumber}`;
}

export function titleHref(titleNumber: string): string {
  return `/hrs/title/${titleNumber}`;
}

/** The whole hierarchy on one page, Division > Title > Chapter. */
export const TREE_HREF = "/hrs/tree";

/** The bare number a citation in running text would use for this section. */
function citationKey(sectionNumber: string): string {
  return sectionNumber.replace(/^§/, "").replace(/ \[OLD\]$/, "");
}

/**
 * Build the index.
 *
 * Two things the full-corpus profile settled:
 *
 * - **Chapters come from the manifest, not from parsed sections.** 293 chapters
 *   are index-only directories whose sections were all repealed. Their chapter
 *   page still exists and is still a valid link target; building the chapter
 *   index from parsed sections loses every one of them.
 * - **The HRS and non-HRS namespaces stay separate.** 89 non-HRS numbers collide
 *   outright with HRS numbers (`1-2` is both HRS §1-2 and CONST §1-2) and 149
 *   are bare. Merging them is how `section 2` acquires a confident link to the
 *   Admission Act. Non-HRS documents are cited with explicit context and are not
 *   resolvable from an HRS-shaped citation, so they are left out entirely until
 *   the proper-citation mapping exists.
 */
export async function buildIndex(preloaded?: ParsedSection[]): Promise<Index> {
  const sections = new Map<string, Target>();
  const chapters = new Map<string, Target>();

  // The site build already holds the whole corpus in memory; re-reading 23,373
  // files to index what the caller is standing on is pure waste.
  const corpus =
    preloaded ??
    (await Promise.all(
      readdirSync(PARSED_DIR).map(
        (file) => Bun.file(`${PARSED_DIR}/${file}`).json() as Promise<ParsedSection>
      )
    ));

  for (const section of corpus) {
    if (section.docType !== "hrs") continue;
    sections.set(citationKey(section.sectionNumber), {
      number: section.sectionNumber,
      kind: "section",
      title: section.title,
      href: sectionHref(section.sectionNumber),
    });
  }

  // Chapter titles live on the index pages and are built into data/chapters.json
  // by `bun run chapters`. The manifest carries no titles — it is an inventory.
  const titlesFile = Bun.file(CHAPTERS_PATH);
  const titles: Record<string, { title: string }> = (await titlesFile.exists())
    ? await titlesFile.json()
    : {};

  const manifest: Manifest = await Bun.file(MANIFEST_PATH).json();
  for (const volume of manifest.volumes) {
    for (const chapter of volume.chapters) {
      // Every chapter directory in the corpus is a real page and a valid link
      // target, so all 1,114 are indexed — including the six non-HRS ones,
      // whose directory names (`01-USCON`, `05-CONST`) also begin with a digit.
      // Keeping them costs nothing: the citation grammar cannot produce a
      // chapter number containing letters after a hyphen, and `classify()`
      // rejects any hyphenated chapter number as Hawaii Administrative Rules
      // before it reaches the index. The *section* namespaces stay separate,
      // which is where the 89 collisions actually live.
      chapters.set(chapter.number, {
        number: chapter.number,
        kind: "chapter",
        title: titles[chapter.number]?.title ?? chapter.title,
        href: chapterHref(chapter.number),
      });
    }
  }

  return {
    sections,
    chapters,
    aliases: sectionNumberAliases(await loadCorrections()),
    cross: buildCrossIndex(corpus),
  };
}

/**
 * Look one candidate up. Returns null when nothing in the corpus matches, which
 * is the signal to leave the text alone and count it.
 */
export function resolve(index: Index, number: string, kind: "section" | "chapter"): Target | null {
  if (kind === "chapter") return index.chapters.get(number) ?? null;
  const direct = index.sections.get(number);
  if (direct) return direct;

  // A citation to a number the source got wrong resolves through the reviewed
  // ledger rather than falling into the unresolved pile. See source-anomalies.md.
  const alias = index.aliases.get(`§${number}`);
  return alias ? index.sections.get(citationKey(alias)) ?? null : null;
}
