import { expect, test, describe } from "bun:test";
import { buildGraph, serializeGraph } from "./graph";
import { sectionSlug, type Index, type Target } from "./resolver";
import type { ParsedSection } from "./config";

function index(sections: string[], chapters: string[] = []): Index {
  const target = (n: string, kind: "section" | "chapter"): Target => ({
    number: kind === "section" ? `§${n}` : n,
    kind,
    title: kind === "section" ? `Title of ${n}.` : `Chapter ${n}`,
    href: kind === "section" ? `/hrs/${sectionSlug(n)}` : `/hrs/chapter/${n}`,
  });
  return {
    sections: new Map(sections.map((n) => [n, target(n, "section")])),
    chapters: new Map(chapters.map((n) => [n, target(n, "chapter")])),
    aliases: new Map(),
  };
}

const section = (over: Partial<ParsedSection> & { sectionNumber: string }): ParsedSection => ({
  title: "A section.",
  bodyText: "",
  bodyHtml: "",
  history: "",
  crossReferences: [],
  caseNotes: "",
  annotations: [],
  partHeading: null,
  chapterNumber: "1",
  docType: "hrs",
  headingIsSupplied: false,
  isRepealed: false,
  covers: null,
  titleIsSupplied: false,
  sourceAnomalies: [],
  numberSource: "page",
  filename: "x.htm",
  url: "https://x/x.htm",
  ...over,
});

const to = (g: ReturnType<typeof buildGraph>, n: string) =>
  (g.cites.get(n) ?? []).map((e) => `${e.to}:${e.block}`).sort();
const from = (g: ReturnType<typeof buildGraph>, n: string) =>
  (g.citedBy.get(n) ?? []).map((e) => `${e.from}:${e.block}`).sort();

describe("buildGraph", () => {
  test("a body citation becomes an edge in both directions", () => {
    const idx = index(["1-1", "1-2"]);
    const g = buildGraph(
      [section({ sectionNumber: "§1-1", bodyText: "See section 1-2." }), section({ sectionNumber: "§1-2" })],
      idx
    );
    expect(to(g, "§1-1")).toEqual(["§1-2:body"]);
    expect(from(g, "§1-2")).toEqual(["§1-1:body"]);
  });

  // History names former compilations, not today's code — 971 of its resolvable
  // citations point at an unrelated section. See citation-linking.md, hazard 9.
  test("legislative history contributes no edges", () => {
    const idx = index(["1-1", "343-7"]);
    const g = buildGraph(
      [section({ sectionNumber: "§1-1", history: "[RL 1955, §343-7; HRS §1-1]" })],
      idx
    );
    expect(g.cites.get("§1-1")).toBeUndefined();
    expect(g.citedBy.get("§343-7")).toBeUndefined();
  });

  test("a section citing its own number adds no edge", () => {
    const idx = index(["1-1"]);
    const g = buildGraph(
      [section({ sectionNumber: "§1-1", bodyText: "Notwithstanding section 1-1(b), the rule applies." })],
      idx
    );
    expect(g.cites.get("§1-1")).toBeUndefined();
    expect(g.citedBy.get("§1-1")).toBeUndefined();
  });

  test("annotations are kept as their own block, not merged with the body", () => {
    const idx = index(["1-1", "1-2"]);
    const g = buildGraph(
      [
        section({
          sectionNumber: "§1-1",
          bodyText: "See section 1-2.",
          annotations: [{ heading: "Case Notes", text: "Discussed in section 1-2." }],
        }),
      ],
      idx
    );
    expect(to(g, "§1-1")).toEqual(["§1-2:annotation", "§1-2:body"]);
  });

  // A section cited only inside a range would otherwise look uncited.
  test("a range contributes its implied members, labelled range", () => {
    const idx = index(["11-1", "11-2", "11-3", "1-1"]);
    const g = buildGraph(
      [section({ sectionNumber: "§1-1", bodyText: "Under sections 11-1 to 11-3, the board acts." })],
      idx
    );
    expect(to(g, "§1-1")).toEqual(["§11-1:body", "§11-2:range", "§11-3:body"]);
  });

  test("repeated citations to the same target collapse to one edge", () => {
    const idx = index(["1-1", "1-2"]);
    const g = buildGraph(
      [section({ sectionNumber: "§1-1", bodyText: "Section 1-2 applies. Again, section 1-2 applies." })],
      idx
    );
    expect(to(g, "§1-1")).toEqual(["§1-2:body"]);
  });

  test("chapter citations are edges too", () => {
    const idx = index(["1-1"], ["91"]);
    const g = buildGraph(
      [section({ sectionNumber: "§1-1", bodyText: "Rules adopted under chapter 91." })],
      idx
    );
    expect(from(g, "91")).toEqual(["§1-1:body"]);
  });

  test("an unresolvable citation contributes nothing", () => {
    const idx = index(["1-1"]);
    const g = buildGraph(
      [section({ sectionNumber: "§1-1", bodyText: "See section 999-999." })],
      idx
    );
    expect(g.cites.get("§1-1")).toBeUndefined();
  });
});

describe("serializeGraph", () => {
  test("nests both directions under each number and sorts numerically", () => {
    const idx = index(["1-1", "1-2", "1-10"]);
    const g = buildGraph(
      [
        section({ sectionNumber: "§1-1", bodyText: "See sections 1-10 and 1-2." }),
        section({ sectionNumber: "§1-2" }),
        section({ sectionNumber: "§1-10" }),
      ],
      idx
    );
    const out = JSON.parse(serializeGraph(g));
    expect(Object.keys(out)).toEqual(["§1-1", "§1-2", "§1-10"]);
    expect(out["§1-1"].cites.map((c: { to: string }) => c.to)).toEqual(["§1-2", "§1-10"]);
    expect(out["§1-2"].citedBy).toEqual([{ from: "§1-1", kind: "section", block: "body" }]);
    expect(out["§1-1"].citedBy).toBeUndefined();
  });

  test("the output is byte-stable across builds", () => {
    const idx = index(["1-1", "1-2"]);
    const corpus = [
      section({ sectionNumber: "§1-1", bodyText: "See section 1-2." }),
      section({ sectionNumber: "§1-2", bodyText: "See section 1-1." }),
    ];
    expect(serializeGraph(buildGraph(corpus, idx))).toBe(
      serializeGraph(buildGraph(corpus, idx))
    );
  });
});
