import { expect, test, describe } from "bun:test";
import {
  docTypeFromFilename,
  extractChapterFromFilename,
  filenameToSectionNumber,
  isIndexFilename,
  normalizeChapterNumber,
  parseChapterIndex,
  parseSection,
} from "./parser";

const page = (body: string) =>
  `<html><head><meta charset="utf-8"></head><body lang="EN-US"><div class="WordSection1">${body}</div>` +
  `<div id="pageLinks"><a href="../x.htm">Previous</a></div></body></html>`;

describe("filenameToSectionNumber", () => {
  // The separator carries the meaning: a second hyphen is an article, an
  // underscore is a decimal. Cases below are real filenames from the corpus.
  const cases: [string, string][] = [
    ["HRS_0001-0001.htm", "§1-1"],
    ["HRS_0001-0002.htm", "§1-2"],
    ["HRS_0001-0004_0005.htm", "§1-4.5"],
    ["HRS_0431-0001-0100.htm", "§431:1-100"],
    ["HRS_0412-0001-0101.htm", "§412:1-101"],
    ["HRS_0431-0001-0100_0005.htm", "§431:1-100.5"],
    ["HRS_0412-0002-0100_0005.htm", "§412:2-100.5"],
    ["HRS_0011-0001_0005_0002.htm", "§11-1.52"],
    ["HRS_0011-0001_0005_0005.htm", "§11-1.55"],
    ["HRS_0431K-0001.htm", "§431K-1"],
    ["HRS_0006D-0001.htm", "§6D-1"],
    ["HRS_0431-0010A-0601.htm", "§431:10A-601"],
    ["HRS_0291-0003_0001.htm", "§291-3.1"],
  ];

  for (const [filename, expected] of cases) {
    test(`${filename} -> ${expected}`, () => {
      expect(filenameToSectionNumber(filename)).toBe(expected);
    });
  }

  test("strips the stray .docx in double-extension filenames", () => {
    expect(filenameToSectionNumber("HRS_0663E-0010.docx.htm")).toBe("§663E-10");
  });

  test("strips the soft hyphen present in one filename", () => {
    expect(filenameToSectionNumber("HRS_0291-0024­_0004.htm")).toBe("§291-24.4");
  });

  test("keeps an [OLD] variant distinct from the live section", () => {
    expect(filenameToSectionNumber("HRS_0431-0009A-0101_[OLD].htm")).toBe("§431:9A-101 [OLD]");
    expect(filenameToSectionNumber("HRS_0431-0009A-0101.htm")).toBe("§431:9A-101");
  });

  test("numbers non-HRS documents under their own prefix", () => {
    expect(filenameToSectionNumber("CONST_0001-0001.htm")).toBe("CONST §1-1");
    expect(filenameToSectionNumber("USCON_AM-0013-0001.htm")).toBe("USCON §AM-13-1");
    expect(filenameToSectionNumber("HHCA_0201_0005.htm")).toBe("HHCA §201.5");
    expect(filenameToSectionNumber("ADM_0002.htm")).toBe("ADM §2");
  });
});

describe("chapter identifiers", () => {
  test("directory names normalize to the section-derived chapter number", () => {
    expect(normalizeChapterNumber("HRS0001")).toBe("1");
    expect(normalizeChapterNumber("HRS0431K")).toBe("431K");
    expect(normalizeChapterNumber("HRS0006D")).toBe("6D");
    // The join key must agree with what the parser derives from a filename,
    // or every section insert fails the foreign key on chapters(number).
    expect(normalizeChapterNumber("HRS0001")).toBe(extractChapterFromFilename("HRS_0001-0002.htm"));
    expect(normalizeChapterNumber("HRS0431K")).toBe(extractChapterFromFilename("HRS_0431K-0001.htm"));
  });

  test("special directories keep their name as the identifier", () => {
    expect(normalizeChapterNumber("05-CONST")).toBe("05-CONST");
    expect(normalizeChapterNumber("06-HHCA")).toBe("06-HHCA");
  });

  test("index pages are recognized by their trailing separator", () => {
    expect(isIndexFilename("HRS_0001-.htm")).toBe(true);
    expect(isIndexFilename("HRS_0431K-.htm")).toBe(true);
    expect(isIndexFilename("CONST_.htm")).toBe(true);
    expect(isIndexFilename("HRS_0001-0002.htm")).toBe(false);
  });

  test("doc type comes from the filename prefix", () => {
    expect(docTypeFromFilename("HRS_0001-0002.htm")).toBe("hrs");
    expect(docTypeFromFilename("CONST_0001-0001.htm")).toBe("const");
    expect(docTypeFromFilename("HHCA_0201.htm")).toBe("hhca");
  });
});

describe("parseSection", () => {
  // Word splits the heading across several <b> elements and leaves the hyphen
  // between them unbolded, which is what broke title extraction before.
  const splitHeading = page(
    `<p class="RegularParagraphs"><b>&nbsp;&nbsp; §1</b>-<b>2&nbsp; Certain laws not obligatory
     until published.</b>&nbsp; No written law, unless otherwise specifically provided by
     legislative enactment, shall be obligatory without first being printed and made
     public. [CC 1859, §1; RL 1925, §3; am L 1935, c 10, §2; HRS §1-2]</p>
     <p class="XNotesHeading">Case Notes</p>
     <p class="XNotes">&nbsp;</p>
     <p class="XNotes">&nbsp; Prior to amendment, statute was so interpreted.&nbsp; 29 H. 250, 255.</p>`
  );

  test("reads a heading that Word split across bold elements", () => {
    const parsed = parseSection(splitHeading, "HRS_0001-0002.htm", "https://x/HRS_0001-0002.htm");
    expect(parsed.sectionNumber).toBe("§1-2");
    expect(parsed.numberSource).toBe("page");
    expect(parsed.title).toBe("Certain laws not obligatory until published.");
  });

  test("body starts at the statute text, with heading and history removed", () => {
    const parsed = parseSection(splitHeading, "HRS_0001-0002.htm", "https://x/HRS_0001-0002.htm");
    expect(parsed.bodyText.startsWith("No written law")).toBe(true);
    expect(parsed.bodyText).not.toContain("Certain laws not obligatory");
    expect(parsed.bodyText).not.toContain("CC 1859");
  });

  test("history is found even when it does not begin with 'L <year>'", () => {
    const parsed = parseSection(splitHeading, "HRS_0001-0002.htm", "https://x/HRS_0001-0002.htm");
    expect(parsed.history).toBe("[CC 1859, §1; RL 1925, §3; am L 1935, c 10, §2; HRS §1-2]");
  });

  test("annotations are captured per heading, not merged into case notes", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>&nbsp; §1-1&nbsp; Common law.</b>&nbsp; The common law of
       England is declared to be the common law of the State. [L 1892, c 57, §5]</p>
       <p class="XNotesHeading">Attorney General Opinions</p>
       <p class="XNotes">&nbsp; Governmental bodies may receive gifts.&nbsp; Att. Gen. Op. 92-4.</p>
       <p class="XNotesHeading">Law Journals and Reviews</p>
       <p class="XNotes">&nbsp; Beach Access:&nbsp; A Public Right?&nbsp; 23 HBJ 65.</p>
       <p class="XNotesHeading">Case Notes</p>
       <p class="XNotes">&nbsp; Generally.</p>`
    );
    const parsed = parseSection(html, "HRS_0001-0001.htm", "https://x/HRS_0001-0001.htm");

    expect(parsed.annotations.map((a) => a.heading)).toEqual([
      "Attorney General Opinions",
      "Law Journals and Reviews",
      "Case Notes",
    ]);
    expect(parsed.caseNotes).toBe("Generally.");
    expect(parsed.caseNotes).not.toContain("Beach Access");
    expect(parsed.bodyText).not.toContain("Att. Gen. Op.");
  });

  test("keeps annotation headings that have no dedicated column", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>§701-100&nbsp; Title and effective date.</b>&nbsp; Title 37
       shall be known as the Hawaii Penal Code. [L 1972, c 9, §1]</p>
       <p class="XNotesHeading">COMMENTARY ON §701-100</p>
       <p class="XNotes">&nbsp; This section establishes the short title.</p>`
    );
    const parsed = parseSection(html, "HRS_0701-0100.htm", "https://x/HRS_0701-0100.htm");
    expect(parsed.annotations[0]?.heading).toBe("COMMENTARY ON §701-100");
    expect(parsed.annotations[0]?.text).toContain("short title");
    expect(parsed.bodyText).not.toContain("short title");
  });

  test("splits cross references into entries", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>§1-3&nbsp; Laws not retrospective.</b>&nbsp; No law has any
       retrospective operation. [CC 1859, §5]</p>
       <p class="XNotesHeading">Cross References</p>
       <p class="XNotes">&nbsp; Construction of laws, see §1-15.</p>
       <p class="XNotes">&nbsp; Severability, see chapter 1.</p>`
    );
    const parsed = parseSection(html, "HRS_0001-0003.htm", "https://x/HRS_0001-0003.htm");
    expect(parsed.crossReferences).toEqual([
      "Construction of laws, see §1-15.",
      "Severability, see chapter 1.",
    ]);
  });

  test("flags a bracketed heading as uncodified and reads its number", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>[</b><b>§11-1.52]</b> <b>Electronic Registration Information
       Center, Inc.; membership.</b>(a) No later than June 30, 2024, the office shall join.</p>`
    );
    const parsed = parseSection(html, "HRS_0011-0001_0005_0002.htm", "https://x/f.htm");
    expect(parsed.sectionNumber).toBe("§11-1.52");
    expect(parsed.isUncodified).toBe(true);
    expect(parsed.title).toBe("Electronic Registration Information Center, Inc.; membership.");
  });

  test("handles a heading whose bold run starts after leading whitespace", () => {
    const html = page(
      `<p class="RegularParagraphs">&nbsp;&nbsp;&nbsp; <b>§11-4&nbsp; Rules.</b>&nbsp; The chief
       election officer may make, amend, and repeal rules governing elections.</p>`
    );
    const parsed = parseSection(html, "HRS_0011-0004.htm", "https://x/f.htm");
    expect(parsed.sectionNumber).toBe("§11-4");
    expect(parsed.title).toBe("Rules.");
    expect(parsed.bodyText.startsWith("The chief election officer")).toBe(true);
    expect(parsed.isRepealed).toBe(false); // "repeal rules" is not a repealed section
  });

  test("reads colon-notation numbers from the page", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>§431:1-100.5&nbsp; Purpose.</b>&nbsp; The legislature hereby
       declares the purpose of this chapter. [L 1987, c 347, §2]</p>`
    );
    const parsed = parseSection(html, "HRS_0431-0001-0100_0005.htm", "https://x/f.htm");
    expect(parsed.sectionNumber).toBe("§431:1-100.5");
    expect(parsed.title).toBe("Purpose.");
  });

  test("falls back to the filename when a page carries no section heading", () => {
    const html = page(`<p class="RegularParagraphs"><b>ARTICLE 1</b></p>`);
    const parsed = parseSection(html, "HRS_0431-0001-0100.htm", "https://x/f.htm");
    expect(parsed.sectionNumber).toBe("§431:1-100");
    expect(parsed.numberSource).toBe("filename");
    expect(parsed.partHeading).toBe("ARTICLE 1");
  });

  test("detects repealed sections", () => {
    const html = page(`<p class="RegularParagraphs"><b>§2-1&nbsp; REPEALED.</b>&nbsp; [L 1972, c 9]</p>`);
    expect(parseSection(html, "HRS_0002-0001.htm", "https://x/f.htm").isRepealed).toBe(true);
  });

  test("uses the chapter number supplied by the manifest when given", () => {
    const html = page(`<p class="RegularParagraphs"><b>§1&nbsp; Title.</b>&nbsp; Text.</p>`);
    const parsed = parseSection(html, "CONST_0001-0001.htm", "https://x/f.htm", "05-CONST");
    expect(parsed.chapterNumber).toBe("05-CONST");
    expect(parsed.docType).toBe("const");
  });

  test("reads a number written with a non-breaking hyphen", () => {
    // Many pages spell the number with U+2011 rather than an ASCII hyphen.
    const html = page(
      `<p class="RegularParagraphs"><b>\u00A711\u20113 Application of chapter.</b>\u00A0 This chapter shall
       apply to all elections held in the State. [L 1970, c 26, \u00A72]</p>`
    );
    const parsed = parseSection(html, "HRS_0011-0003.htm", "https://x/f.htm");
    expect(parsed.sectionNumber).toBe("\u00A711-3");
    expect(parsed.numberSource).toBe("page");
    expect(parsed.title).toBe("Application of chapter.");
    expect(parsed.bodyText).not.toContain("\u2011");
  });

  test("finds the section when an annotation precedes it", () => {
    // A PART banner, a Note about the part, then the section itself.
    const html = page(
      `<p class="RegularParagraphs"><b>PART I. GENERAL PROVISIONS</b></p>
       <p class="XNotesHeading">Note</p>
       <p class="XNotes">&nbsp; Sections 10-1 to 10-16 designated as Part I by L 1994, c 283, \u00A72(1).</p>
       <p class="RegularParagraphs">&nbsp; <b>[\u00A710-1]&nbsp; Declaration of purpose.</b>&nbsp; (a) The people of
       the State of Hawaii established a public trust. [L 1979, c 196, \u00A71]</p>`
    );
    const parsed = parseSection(html, "HRS_0010-0001.htm", "https://x/f.htm");
    expect(parsed.sectionNumber).toBe("\u00A710-1");
    expect(parsed.numberSource).toBe("page");
    expect(parsed.title).toBe("Declaration of purpose.");
    expect(parsed.isUncodified).toBe(true);
    expect(parsed.partHeading).toBe("PART I. GENERAL PROVISIONS");
    expect(parsed.bodyText).toContain("public trust");
    expect(parsed.annotations.map((a) => a.heading)).toEqual(["Note"]);
    expect(parsed.annotations[0]?.text).not.toContain("Declaration of purpose");
  });

  test("keeps a body that consists only of a bracketed repeal note", () => {
    const html = page(
      `<p class="RegularParagraphs">&nbsp; [Sections 2 and 3.&nbsp; Repealed, June 25, 1948,
       c 646, \u00A739, 62 Stat 992.]</p>`
    );
    const parsed = parseSection(html, "HNP_0002.htm", "https://x/f.htm");
    expect(parsed.bodyText).toContain("Repealed");
    expect(parsed.isRepealed).toBe(true);
  });

  test("excludes navigation chrome from the captured HTML", () => {
    const parsed = parseSection(splitHeading, "HRS_0001-0002.htm", "https://x/f.htm");
    expect(parsed.bodyHtml).not.toContain("pageLinks");
    expect(parsed.bodyHtml).toContain("RegularParagraphs");
  });
});

describe("parseChapterIndex", () => {
  test("reads the chapter title that follows the CHAPTER line", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>CHAPTER 431K</b></p>
       <p class="RegularParagraphs"><b>RISK RETENTION</b></p>
       <p class="RegularParagraphs">Section</p>
       <p class="RegularParagraphs">431K-1 Definitions</p>`
    );
    const index = parseChapterIndex(html, "HRS_0431K-.htm", "https://x/f.htm", "431K");
    expect(index.chapterNumber).toBe("431K");
    expect(index.title).toBe("RISK RETENTION");
  });

  test("skips the title-level table of contents above the CHAPTER line", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>DIVISION 1. GOVERNMENT</b></p>
       <p class="RegularParagraphs"><b>TITLE 1. GENERAL PROVISIONS</b></p>
       <p class="RegularParagraphs">Chapter</p>
       <p class="RegularParagraphs">1 Common Law; Construction of Laws</p>
       <p class="RegularParagraphs">1B Designation of Rural Areas</p>
       <p class="RegularParagraphs"><b>CHAPTER 1</b></p>
       <p class="RegularParagraphs"><b>COMMON LAW; CONSTRUCTION OF LAWS</b></p>
       <p class="RegularParagraphs">Section</p>`
    );
    const index = parseChapterIndex(html, "HRS_0001-.htm", "https://x/f.htm", "1");
    expect(index.title).toBe("COMMON LAW; CONSTRUCTION OF LAWS");
  });
});
