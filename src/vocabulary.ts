/**
 * The corpus vocabulary, for spelling suggestions on the search page.
 *
 * Pagefind has no typo tolerance, and its failure mode is worse than returning
 * nothing: a misspelling degrades into partial matches that look like real
 * results. Measured against this corpus — `marijuana` finds the right 59
 * sections, `marijauna` returns 3 unrelated ones, and `cannabus` returns 878.
 * A reader has no way to tell those apart, which is the same confidently-wrong
 * failure the citation linker is built to avoid.
 *
 * Having the whole corpus makes the honest answer cheap: we know exactly which
 * words appear in the statutes, so "that word is not in the HRS" is a fact we
 * can state rather than a guess. The suggestion on top of it is a bonus.
 *
 * Thresholds are a size/coverage trade, measured:
 *
 * | filter | words | gzipped |
 * |---|---|---|
 * | len>=4, freq>=1 | 30,679 | 131 KB |
 * | **len>=5, freq>=3** | **17,223** | **70 KB** |
 * | len>=5, freq>=10 | 10,382 | 41 KB |
 *
 * `freq>=3` drops one-off typos in the published source without losing real
 * legal terms — `riparian` (15) and `escheat` (44) both survive. Words shorter
 * than five characters are excluded because an edit-distance suggestion on them
 * is rarely right and they are mostly stopwords.
 */
import type { ParsedSection } from "./config";

export const MIN_LENGTH = 5;
export const MIN_FREQUENCY = 3;

/** Words as the search index sees them: lowercase, apostrophes and hyphens kept. */
const WORD = /[a-z][a-z'’-]{3,}/g;

/**
 * Count every word in the corpus, including annotations.
 *
 * Annotations are included because they are indexed and searched — a reader who
 * searches a term that only appears in a case note should not be told it is
 * absent from the statutes.
 */
export function countWords(corpus: ParsedSection[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const section of corpus) {
    const text = `${section.title} ${section.bodyText} ${section.annotations
      .map((a) => a.text)
      .join(" ")}`;
    for (const match of text.toLowerCase().matchAll(WORD)) {
      const word = match[0].replace(/['’-]+$/, "");
      if (word.length < MIN_LENGTH) continue;
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }
  return freq;
}

/**
 * Serialize as newline-separated words, sorted.
 *
 * Plain text rather than JSON: it is a third smaller, parses with `split`, and
 * sorting keeps it byte-stable across builds.
 */
export function serializeVocabulary(freq: Map<string, number>): string {
  const words = [...freq]
    .filter(([word, n]) => word.length >= MIN_LENGTH && n >= MIN_FREQUENCY)
    .map(([word]) => word)
    .sort();
  return `${words.join("\n")}\n`;
}
