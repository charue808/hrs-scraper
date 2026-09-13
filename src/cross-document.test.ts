import { expect, test, describe } from "bun:test";
import { buildCrossIndex, detectCrossDocument, properCitation } from "./cross-document";
import type { DocType, ParsedSection } from "./config";

const section = (sectionNumber: string, docType: DocType, title = ""): ParsedSection => ({
  sectionNumber,
  title,
  bodyText: "",
  bodyHtml: "",
  history: "",
  crossReferences: [],
  caseNotes: "",
  annotations: [],
  partHeading: null,
  chapterNumber: "05-CONST",
  docType,
  headingIsSupplied: false,
  isRepealed: false,
  covers: null,
  titleIsSupplied: false,
  sourceAnomalies: [],
  numberSource: "filename",
  filename: "x.htm",
  url: "https://x/x.htm",
});

const index = buildCrossIndex([
  section("CONST §1-5", "const", "DUE PROCESS AND EQUAL PROTECTION"),
  section("CONST §1-10", "const"),
  section("CONST §12-7", "const", "TRADITIONAL AND CUSTOMARY RIGHTS"),
  section("CONST §5-6", "const"),
  section("USCON §1-10", "uscon"),
  section("USCON §AM-6", "uscon"),
  section("USCON §AM-14", "uscon"),
  section("ORG §73", "org", "Commissioner of public lands."),
  section("ORG §17", "org"),
  section("ADM §5", "adm"),
  section("HHCA §203", "hhca"),
  section("HHCA §208", "hhca"),
  // An HRS section, to prove these never enter the cross-document index.
  { ...section("§1-5", "hrs"), chapterNumber: "1" },
]);

const found = (text: string) =>
  detectCrossDocument(text, index).map((c) => `${c.text} => ${c.target.number}`);

describe("the namespaces stay separate", () => {
  // 89 non-HRS numbers collide outright with HRS numbers and 149 are bare.
  // Resolution requires the document to be named; this is the whole safety
  // argument for linking them at all.
  test("a number with no document named resolves to nothing", () => {
    expect(found("as provided in section 203 of this chapter")).toEqual([]);
    expect(found("under section 2, the board shall act")).toEqual([]);
    expect(found("pursuant to article I, §5")).toEqual([]);
  });

  test("HRS sections never enter the cross-document index", () => {
    expect(index.documents.has("hrs" as DocType)).toBe(false);
  });

  test("a document named with no number at all is prose, not a citation", () => {
    expect(found("conflicts with the Hawaii State Constitution generally")).toEqual([]);
  });
});

describe("the articled documents", () => {
  test("article and section, either notation", () => {
    expect(found("unconstitutional under article I, §5 of the Hawaii constitution")).toEqual([
      "article I, §5 => CONST §1-5",
    ]);
    expect(found("subject to Article V, section 6 of the Constitution of the State")).toEqual([
      "Article V, section 6 => CONST §5-6",
    ]);
  });

  test("an amendment cited by ordinal word", () => {
    expect(found("the Sixth Amendment to the U.S. Constitution")).toEqual([
      "Sixth Amendment => USCON §AM-6",
    ]);
    expect(found("under the Fourteenth Amendment of the United States Constitution")).toEqual([
      "Fourteenth Amendment => USCON §AM-14",
    ]);
  });

  test("the document may be named before the citation", () => {
    expect(found("under U.S. Const. Art. I, §10 the State may not")).toEqual([
      "Art. I, §10 => USCON §1-10",
    ]);
  });
});

describe("the flat documents", () => {
  test("section of a named act", () => {
    expect(found("Lands designated in section 203 of the Hawaiian Homes Commission Act")).toEqual([
      "section 203 => HHCA §203",
    ]);
    expect(found("ownership under section 73 of the Hawaiian Organic Act")).toEqual([
      "section 73 => ORG §73",
    ]);
    expect(found("violated §5 of the Admission Act")).toEqual(["§5 => ADM §5"]);
  });

  test("the act may be named first", () => {
    expect(found("see notes to Organic Act §73")).toEqual(["§73 => ORG §73"]);
  });

  test("a subsection in parentheses is not part of the number", () => {
    expect(found("in pursuance of section 208(5) of the Hawaiian Homes Commission Act")).toEqual([
      "section 208 => HHCA §208",
    ]);
  });
});

describe("guards against wrong links", () => {
  // `see §171-64.7` inside an Organic Act sentence matched as `§17` and linked
  // to Organic Act §17 before this guard existed.
  test("an HRS section number is not truncated into a flat citation", () => {
    expect(found("under the Organic Act, see §171-64.7 for the procedure")).toEqual([]);
  });

  // "U.S. Constitution" sits 8 characters before the article and "Constitution
  // of the State of Hawaii" 9 after, so proximity alone picks the wrong one.
  test("the binding `of the` phrase beats raw proximity", () => {
    expect(
      found(
        "secured by the Sixth Amendment to the U.S. Constitution and by Article I, Section 10, of the Constitution of the State of Hawaii."
      )
    ).toEqual(["Sixth Amendment => USCON §AM-6", "Article I, Section 10 => CONST §1-10"]);
  });

  test("a citation does not reach across a sentence boundary", () => {
    expect(found("See notes to Organic Act. Legislative approval, see section 73 below.")).toEqual(
      []
    );
  });

  // `U.S. Const., 5th Am.; Const. art. I, §10` is two citations to two
  // documents; letting the first name reach across the semicolon attaches the
  // second to it.
  test("a citation does not reach across a semicolon", () => {
    expect(found("U.S. Constitution applies; article I, §5 does not")).toEqual([]);
  });

  test("a number too far from the document name is not claimed", () => {
    const far = "the Admission Act " + "x".repeat(80) + " section 5";
    expect(found(far)).toEqual([]);
  });
});

describe("properCitation", () => {
  const cases: [string, DocType, string][] = [
    ["CONST §1-5", "const", "Haw. Const. art. I, §5"],
    ["CONST §12-7", "const", "Haw. Const. art. XII, §7"],
    ["USCON §1-10", "uscon", "U.S. Const. art. I, §10"],
    ["USCON §AM-6", "uscon", "U.S. Const. amend. VI"],
    ["USCON §AM-25-2", "uscon", "U.S. Const. amend. XXV, §2"],
    ["ORG §73", "org", "Organic Act §73"],
    ["ADM §5", "adm", "Admission Act §5"],
    ["HHCA §203", "hhca", "HHCA §203"],
    ["HNP §4", "hnp", "Hawaii National Park Act §4"],
  ];
  for (const [number, docType, expected] of cases) {
    test(`${number} -> ${expected}`, () => {
      expect(properCitation(section(number, docType))).toBe(expected);
    });
  }

  // The identifier stays the key and the URL; only the display changes, so
  // nothing that already links to these pages breaks.
  test("the target keeps its identifier and carries the citation as a label", () => {
    const target = index.documents.get("const")!.get("12-7")!;
    expect(target.number).toBe("CONST §12-7");
    expect(target.label).toBe("Haw. Const. art. XII, §7");
    expect(target.href).toBe("/hrs/CONST-12-7");
  });
});
