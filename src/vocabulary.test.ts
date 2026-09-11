import { expect, test, describe } from "bun:test";
import { countWords, serializeVocabulary, MIN_FREQUENCY, MIN_LENGTH } from "./vocabulary";
import type { ParsedSection } from "./config";

const section = (over: Partial<ParsedSection>): ParsedSection => ({
  sectionNumber: "§1-1",
  title: "",
  bodyText: "",
  bodyHtml: "",
  history: "",
  crossReferences: [],
  caseNotes: "",
  annotations: [],
  partHeading: null,
  chapterNumber: "1",
  docType: "hrs",
  isUncodified: false,
  isRepealed: false,
  covers: null,
  titleIsSupplied: false,
  sourceAnomalies: [],
  numberSource: "page",
  filename: "x.htm",
  url: "https://x/x.htm",
  ...over,
});

const words = (corpus: ParsedSection[]) => serializeVocabulary(countWords(corpus)).trim().split("\n").filter(Boolean);

const repeat = (word: string, n: number) => `${word} `.repeat(n);

describe("countWords", () => {
  test("counts title, body and annotations together", () => {
    const freq = countWords([
      section({
        title: "Marijuana",
        bodyText: "marijuana and cannabis",
        annotations: [{ heading: "Case Notes", text: "Marijuana again." }],
      }),
    ]);
    expect(freq.get("marijuana")).toBe(3);
    expect(freq.get("cannabis")).toBe(1);
  });

  // A reader searching a term that only appears in a case note should not be
  // told it is absent from the statutes.
  test("annotations count, because they are indexed and searched", () => {
    const freq = countWords([
      section({ annotations: [{ heading: "Case Notes", text: "riparian rights" }] }),
    ]);
    expect(freq.get("riparian")).toBe(1);
  });

  // Legislative history is indexed like the rest of the page, but it is not a
  // separate field here — it never reaches the vocabulary.
  test("history is not counted", () => {
    const freq = countWords([section({ history: "[L 1955, c 1, escheatment]" })]);
    expect(freq.get("escheatment")).toBeUndefined();
  });

  test("words shorter than the minimum are ignored", () => {
    const freq = countWords([section({ bodyText: "the land is wet" })]);
    expect(freq.get("land")).toBeUndefined();
    expect([...freq.keys()].every((w) => w.length >= MIN_LENGTH)).toBe(true);
  });

  test("trailing punctuation is trimmed but internal marks are kept", () => {
    const freq = countWords([section({ bodyText: "owner's- lessee's property" })]);
    expect(freq.get("owner's")).toBe(1);
    expect(freq.get("lessee's")).toBe(1);
  });
});

describe("serializeVocabulary", () => {
  // The threshold drops one-off typos in the published source without losing
  // real legal terms.
  test("a word below the frequency threshold is dropped", () => {
    const rare = words([section({ bodyText: repeat("marijuana", MIN_FREQUENCY - 1) })]);
    expect(rare).not.toContain("marijuana");

    const kept = words([section({ bodyText: repeat("marijuana", MIN_FREQUENCY) })]);
    expect(kept).toContain("marijuana");
  });

  test("output is sorted, so the file is byte-stable across builds", () => {
    const corpus = [
      section({ bodyText: repeat("zoning", MIN_FREQUENCY) + repeat("abandonment", MIN_FREQUENCY) }),
    ];
    const first = serializeVocabulary(countWords(corpus));
    expect(first).toBe(serializeVocabulary(countWords(corpus)));
    expect(first.trim().split("\n")).toEqual(["abandonment", "zoning"]);
  });

  test("the file ends with a newline and holds one word per line", () => {
    const text = serializeVocabulary(countWords([section({ bodyText: repeat("easement", 5) })]));
    expect(text).toBe("easement\n");
  });
});
