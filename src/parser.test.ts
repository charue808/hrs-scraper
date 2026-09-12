import { expect, test, describe } from "bun:test";
import {
  docTypeFromFilename,
  extractChapterFromFilename,
  filenameToSectionNumber,
  isIndexFilename,
  normalizeChapterNumber,
  parseChapterIndex,
  parseSection,
  parseTitleBanner,
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

  // The constitutions print the catchline as a centred upper-case line above a
  // `Section n.` heading, with a blank paragraph between one centred item and
  // the next. The blank is the separator: a catchline that wraps to a second
  // line has none between its lines.
  const centred = (text: string) =>
    `<p class="RegularParagraphs" align="center" style='text-align:center'><b>${text}</b></p>`;
  const blank = `<p class="RegularParagraphs">&nbsp;</p>`;

  test("takes a constitutional catchline from the line above the heading", () => {
    const html = page(
      `${centred("DUE PROCESS AND EQUAL PROTECTION")}${blank}
       <p class="RegularParagraphs"><b>Section 5.</b> No person shall be deprived of life. [Ren and am Const Con 1978]</p>`
    );
    const parsed = parseSection(html, "CONST_0001-0005.htm", "https://x/f.htm", "05-CONST");
    expect(parsed.sectionNumber).toBe("CONST §1-5");
    expect(parsed.title).toBe("DUE PROCESS AND EQUAL PROTECTION");
    expect(parsed.bodyText).not.toContain("DUE PROCESS");
  });

  test("joins a catchline that wraps to a second centred line", () => {
    // CONST_0005-0006.htm: the title was "AND DEPARTMENTS".
    const html = page(
      `${centred("EXECUTIVE AND ADMINISTRATIVE OFFICES")}${centred("AND DEPARTMENTS")}${blank}
       <p class="RegularParagraphs"><b>Section 6.</b> All executive and administrative offices. [Ren Const Con 1978]</p>`
    );
    const parsed = parseSection(html, "CONST_0005-0006.htm", "https://x/f.htm", "05-CONST");
    expect(parsed.title).toBe("EXECUTIVE AND ADMINISTRATIVE OFFICES AND DEPARTMENTS");
    expect(parsed.bodyText).not.toContain("DEPARTMENTS");
  });

  test("keeps an article's title apart from its first section's catchline", () => {
    // An article banner page: ARTICLE, blank, article title, blank, an
    // annotation, then the section's own catchline and heading. Every item is
    // separated by a blank, so nothing joins.
    const html = page(
      `${centred("ARTICLE I")}${blank}${centred("BILL OF RIGHTS")}${blank}
       <p class="XNotesHeading">Law Journals and Reviews</p>
       <p class="XNotes">The Protection of Individual Rights. 14 UH L. Rev. 311.</p>
       ${blank}${centred("POLITICAL POWER")}${blank}
       <p class="RegularParagraphs"><b>Section 1.</b> All political power of this State is inherent in the people. [Ren Const Con 1978]</p>`
    );
    const parsed = parseSection(html, "CONST_0001-0001.htm", "https://x/f.htm", "05-CONST");
    expect(parsed.title).toBe("POLITICAL POWER");
    expect(parsed.partHeading).toBe("ARTICLE I — BILL OF RIGHTS");
    expect(parsed.bodyText).toContain("political power");
    expect(parsed.annotations.map((a) => a.heading)).toEqual(["Law Journals and Reviews"]);
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

  // 293 chapters have no sections at all — every one was repealed, so nothing in
  // data/parsed carries their number and their index page is the only thing
  // that says what happened. Measured: none of the 293 has a section listing,
  // and 290 have notes.
  test("captures the repeal note and cross references of a section-less chapter", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>CHAPTER 2</b></p>
       <p class="RegularParagraphs"><b>STATUTE REVISION AND PUBLICATION</b></p>
       <p class="RegularParagraphs">REPEALED. L Sp 1977 1st, c 8, §3.</p>
       <p class="XNotesHeading">Cross References</p>
       <p class="XNotes">For present provisions, see chapter 23G, pt. II.</p>`
    );
    const index = parseChapterIndex(html, "HRS_0002-.htm", "https://x/f.htm", "2");
    expect(index.title).toBe("STATUTE REVISION AND PUBLICATION");
    expect(index.notes).toBe("REPEALED. L Sp 1977 1st, c 8, §3.");
    expect(index.annotations).toEqual([
      { heading: "Cross References", text: "For present provisions, see chapter 23G, pt. II." },
    ]);
  });

  // An index page usually opens with the division/title table of contents, which
  // carries its own Cross References for the whole title. Those belong to the
  // title, not to this chapter — HRS_0091-.htm is the real case.
  test("excludes annotations belonging to the title above the chapter", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>TITLE 8. PUBLIC PROCEEDINGS</b></p>
       <p class="RegularParagraphs">Chapter</p>
       <p class="RegularParagraphs">91 Administrative Procedure</p>
       <p class="XNotesHeading">Cross References</p>
       <p class="XNotes">Alternative dispute resolution center, see chapter 613.</p>
       <p class="RegularParagraphs"><b>CHAPTER 91</b></p>
       <p class="RegularParagraphs"><b>ADMINISTRATIVE PROCEDURE</b></p>
       <p class="RegularParagraphs">Section</p>
       <p class="RegularParagraphs">91-1 Definitions</p>
       <p class="XNotesHeading">Case Notes</p>
       <p class="XNotes">Statutory authority is necessary.</p>`
    );
    const index = parseChapterIndex(html, "HRS_0091-.htm", "https://x/f.htm", "91");
    expect(index.annotations).toEqual([
      { heading: "Case Notes", text: "Statutory authority is necessary." },
    ]);
  });

  // A superseded banner precedes the live one, and brings its own repeal note
  // and cross references with it — HRS_0431-.htm. Attributing those to the live
  // chapter would label the current Insurance Code as repealed.
  test("excludes the notes of a superseded [OLD] banner", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>CHAPTER 431 [OLD]</b></p>
       <p class="RegularParagraphs"><b>THE HAWAII INSURANCE LAW</b></p>
       <p class="RegularParagraphs">REPEALED. L 1987, c 347, §1.</p>
       <p class="XNotesHeading">Cross References</p>
       <p class="XNotes">For disposition of repealed provisions, see the table.</p>
       <p class="RegularParagraphs"><b>CHAPTER 431</b></p>
       <p class="RegularParagraphs"><b>INSURANCE CODE</b></p>
       <p class="RegularParagraphs">ARTICLE 1. DEFINITIONS</p>
       <p class="RegularParagraphs">Section</p>
       <p class="RegularParagraphs">431:1-100 Short title</p>`
    );
    const index = parseChapterIndex(html, "HRS_0431-.htm", "https://x/f.htm", "431");
    expect(index.title).toBe("INSURANCE CODE");
    expect(index.notes).toBe("");
    expect(index.annotations).toEqual([]);
  });

  // A block is continued only by an XNotes paragraph. Without that rule an
  // annotation opened before the listing swallows it — chapter 431's index page
  // is 2,149 paragraphs long.
  test("an annotation block does not swallow the section listing", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>CHAPTER 76</b></p>
       <p class="RegularParagraphs"><b>CIVIL SERVICE LAW</b></p>
       <p class="XNotesHeading">Note</p>
       <p class="XNotes">Chapter heading amended by L 2000, c 253, §15.</p>
       <p class="RegularParagraphs">Section</p>
       <p class="RegularParagraphs">76-1 Purpose</p>
       <p class="RegularParagraphs">76-2 Definitions</p>`
    );
    const index = parseChapterIndex(html, "HRS_0076-.htm", "https://x/f.htm", "76");
    expect(index.annotations).toEqual([
      { heading: "Note", text: "Chapter heading amended by L 2000, c 253, §15." },
    ]);
    expect(index.notes).toBe("");
  });

  test("a chapter that goes straight into its listing has no notes", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>CHAPTER 1</b></p>
       <p class="RegularParagraphs"><b>COMMON LAW</b></p>
       <p class="RegularParagraphs">Section</p>
       <p class="RegularParagraphs">1-1 Common law of the State; exceptions</p>`
    );
    const index = parseChapterIndex(html, "HRS_0001-.htm", "https://x/f.htm", "1");
    expect(index.notes).toBe("");
    expect(index.annotations).toEqual([]);
  });
});

describe("part banners", () => {
  // The HRS brackets material supplied by the revisor rather than enacted, and
  // applies that to structural banners as well as section headings. Missing the
  // bracketed form dropped 298 sections across 119 chapters — chapter 37 showed
  // 4 of its 7 parts.
  const cases: [string, string][] = [
    ["PART V. GENERAL FUND EXPENDITURE CEILING", "unbracketed"],
    ["[PART IV. THE EXECUTIVE BUDGET]", "whole banner bracketed"],
    ["[PART VII.] ROUTINE REPAIR AND MAINTENANCE", "only the designation bracketed"],
    ["[ARTICLE 9J]", "article, bracketed"],
  ];

  for (const [banner, label] of cases) {
    test(`captures a banner with ${label}`, () => {
      const html = page(
        `<p class="RegularParagraphs">${banner}</p>
         <p class="RegularParagraphs"><b>§37-61 Short title.</b>  This part may be cited as the Act.</p>`
      );
      const parsed = parseSection(html, "HRS_0037-0061.htm", "https://x/f.htm");
      expect(parsed.partHeading).toBe(banner);
    });
  }

  // The banner is moved into partHeading, not copied. Leaving it in the body
  // renders it twice — which it did on 1,243 of the 1,247 sections with one.
  test("the banner is removed from bodyText rather than duplicated", () => {
    const html = page(
      `<p class="RegularParagraphs">PART II. ALLOTMENT SYSTEM</p>
       <p class="RegularParagraphs"><b>§37-31 Intent and policy.</b>  It is declared to be the policy.</p>`
    );
    const parsed = parseSection(html, "HRS_0037-0031.htm", "https://x/f.htm");
    expect(parsed.partHeading).toBe("PART II. ALLOTMENT SYSTEM");
    expect(parsed.bodyText).toBe("It is declared to be the policy.");
  });

  // A page whose only content is the banner ends up with an empty body, which
  // is correct: the banner is the content, and it is held in partHeading.
  test("a banner-only page keeps the banner in partHeading and empties the body", () => {
    const html = page(`<p class="RegularParagraphs">ARTICLE 1</p>`);
    const parsed = parseSection(html, "HRS_0431-0001-.htm", "https://x/f.htm");
    expect(parsed.partHeading).toBe("ARTICLE 1");
    expect(parsed.bodyText).toBe("");
  });

  test("an ordinary opening paragraph is not mistaken for a banner", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>§1-1 Common law.</b>  The common law of England.</p>`
    );
    const parsed = parseSection(html, "HRS_0001-0001.htm", "https://x/f.htm");
    expect(parsed.partHeading).toBeNull();
  });
});

describe("range headings", () => {
  // 274 pages in the corpus stand for a span of sections rather than one, and
  // the range expression previously bled into the title.
  test("splits the range off the title and records the span", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>&nbsp; §515-10 to 515-12 REPEALED.</b>&nbsp;
       L 1989, c 269, §3.</p>`
    );
    const parsed = parseSection(html, "HRS_0515-0010.htm", "https://x/HRS_0515-0010.htm");
    expect(parsed.sectionNumber).toBe("§515-10");
    expect(parsed.title).toBe("REPEALED.");
    expect(parsed.numberSource).toBe("page-range");
    expect(parsed.covers).toEqual({ start: "§515-10", end: "§515-12", raw: "to 515-12" });
  });

  // The corpus abbreviates the end when the chapter is unchanged: "§39-125 to
  // 131" means §39-131, not §131.
  test("expands an abbreviated range end against its start", () => {
    const html = page(`<p class="RegularParagraphs"><b>&nbsp; §39-125 to 131 REPEALED.</b></p>`);
    const parsed = parseSection(html, "HRS_0039-0125.htm", "https://x/HRS_0039-0125.htm");
    expect(parsed.covers?.end).toBe("§39-131");
  });

  test("expands an abbreviated decimal end", () => {
    const html = page(`<p class="RegularParagraphs"><b>&nbsp; §486J-4 to 5.3 REPEALED.</b></p>`);
    const parsed = parseSection(html, "HRS_0486J-0004.htm", "https://x/HRS_0486J-0004.htm");
    expect(parsed.covers?.end).toBe("§486J-5.3");
  });

  // The file is not always the range's start, which is how three files ended up
  // claiming a section number that belonged to another file.
  test("takes the number from the filename when the file is the range end", () => {
    const html = page(`<p class="RegularParagraphs"><b>&nbsp; §425-151 to 425-180 REPEALED.</b></p>`);
    const parsed = parseSection(html, "HRS_0425-0180.htm", "https://x/HRS_0425-0180.htm");
    expect(parsed.sectionNumber).toBe("§425-180");
    expect(parsed.covers?.start).toBe("§425-151");
  });

  // A comma followed by "and" must not end the list early.
  test("continues a list across an Oxford comma", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>&nbsp; §602-22 to 602-24, 602-31 to 602-34, 602-36,
       and 602-37 REPEALED.</b></p>`
    );
    const parsed = parseSection(html, "HRS_0602-0022.htm", "https://x/HRS_0602-0022.htm");
    expect(parsed.title).toBe("REPEALED.");
    expect(parsed.covers?.end).toBe("§602-37");
  });

  // The range is consumed only at the start of the title: a title can mention a
  // different span further along.
  test("does not consume a range that appears inside the title", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>&nbsp; §349-12 to 349-14 Renumbered as §§349-21 to
       349-23.</b></p>`
    );
    const parsed = parseSection(html, "HRS_0349-0012.htm", "https://x/HRS_0349-0012.htm");
    expect(parsed.title).toBe("Renumbered as §§349-21 to 349-23.");
    expect(parsed.covers?.end).toBe("§349-14");
  });

  test("a title that merely begins with the word 'to' is not a range", () => {
    const html = page(`<p class="RegularParagraphs"><b>&nbsp; §532-2 To heirs.</b>&nbsp; Text.</p>`);
    const parsed = parseSection(html, "HRS_0532-0002.htm", "https://x/HRS_0532-0002.htm");
    expect(parsed.title).toBe("To heirs.");
    expect(parsed.covers).toBeNull();
    expect(parsed.numberSource).toBe("page");
  });

  // A repealed-range banner for an [OLD] part can sit above the section the
  // file is actually for; the heading matching the filename wins.
  test("prefers the heading that agrees with the filename", () => {
    const html = page(
      `<p class="RegularParagraphs">PART II. [OLD] DONATION OF EYES</p>
       <p class="RegularParagraphs"><b>&nbsp; §327-21 to 327-24 REPEALED.</b>&nbsp; L 1969, c 81, §2.</p>
       <p class="RegularParagraphs">PART II. DISPOSITION OF DEAD HUMAN BODIES</p>
       <p class="RegularParagraphs"><b>&nbsp; §327-31 REPEALED.</b>&nbsp; L 2012, c 75, §6.</p>`
    );
    const parsed = parseSection(html, "HRS_0327-0031.htm", "https://x/HRS_0327-0031.htm");
    expect(parsed.sectionNumber).toBe("§327-31");
    expect(parsed.title).toBe("REPEALED.");
    expect(parsed.covers).toBeNull();
  });
});

describe("bracketed headings", () => {
  test("drops the closing bracket of a fully bracketed heading", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>[§440G-16 Rules.]</b>&nbsp; The director shall adopt
       rules pursuant to chapter 91. [L 1987, c 301, §20]</p>`
    );
    const parsed = parseSection(html, "HRS_0440G-0016.htm", "https://x/HRS_0440G-0016.htm");
    expect(parsed.title).toBe("Rules.");
    expect(parsed.isUncodified).toBe(true);
    expect(parsed.titleIsSupplied).toBe(false);
  });

  // A bracket around the title alone marks a catchline supplied editorially
  // rather than enacted — a different fact from the section being uncodified.
  test("unwraps a bracketed title and records that it was supplied", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>§604-13&nbsp; [Arrest under warrant.]</b>&nbsp; Text.</p>`
    );
    const parsed = parseSection(html, "HRS_0604-0013.htm", "https://x/HRS_0604-0013.htm");
    expect(parsed.title).toBe("Arrest under warrant.");
    expect(parsed.titleIsSupplied).toBe(true);
    expect(parsed.isUncodified).toBe(false);
  });

  // "[OLD]" is a marker inside the title, not a bracket around it.
  test("leaves an [OLD] marker in the title alone", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>§226-53 [OLD] REPEALED.</b>&nbsp; L 1991, c 76, pt of §1.</p>`
    );
    const parsed = parseSection(html, "HRS_0226-0053.htm", "https://x/HRS_0226-0053.htm");
    expect(parsed.title).toBe("[OLD] REPEALED.");
    expect(parsed.titleIsSupplied).toBe(false);
  });
});

describe("lowercase chapter letters in filenames", () => {
  // A handful of filenames write the chapter's letter suffix in lowercase. The
  // page always writes it uppercase, so leaving it produces a number that
  // matches neither the page nor the resolver's index.
  test("uppercases the letter suffix", () => {
    expect(filenameToSectionNumber("HRS_0039a-0112.htm")).toBe("§39A-112");
    expect(filenameToSectionNumber("HRS_0206j-0017.htm")).toBe("§206J-17");
    expect(filenameToSectionNumber("HRS_0516d-0011_0006.htm")).toBe("§516D-11.6");
  });

  test("agrees with the chapter number derived from the directory", () => {
    expect(extractChapterFromFilename("HRS_0039a-0112.htm")).toBe("39A");
    expect(normalizeChapterNumber("HRS0039A")).toBe("39A");
  });
});

describe("non-HRS documents", () => {
  // The section number built from a page heading previously dropped the
  // document prefix, so HHCA §501 came out as a bare §501.
  test("keeps the document prefix on a page-derived number", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>&nbsp; §501 to 516. REPEALED.</b>&nbsp; L 1990, c 349.</p>`
    );
    const parsed = parseSection(html, "HHCA_0501.htm", "https://x/HHCA_0501.htm");
    expect(parsed.sectionNumber).toBe("HHCA §501");
    expect(parsed.title).toBe("REPEALED.");
    expect(parsed.covers).toEqual({ start: "HHCA §501", end: "HHCA §516", raw: "to 516." });
  });
});

test("a single-digit range end is a range", () => {
  const html = page(`<p class="RegularParagraphs"><b>&nbsp; §5-1 to 3 REPEALED.</b></p>`);
  const parsed = parseSection(html, "HRS_0005-0001.htm", "https://x/HRS_0005-0001.htm");
  expect(parsed.title).toBe("REPEALED.");
  expect(parsed.covers?.end).toBe("§5-3");
});

describe("subsection markers in headings", () => {
  // Word writes `<b>§26-12 Title. </b>(a)<b> </b>The department...`. The "(a)"
  // is unbolded and short enough to look like one of the connectors that hold a
  // split heading together, which appended it to the title and dropped it from
  // the body.
  test("a subsection marker ends the heading and stays in the body", () => {
    const html = page(
      `<p class="RegularParagraphs"> <b>§26-12 Department of education. </b>(a)<b> </b>The
       department of education shall be headed by an executive board. [L 1959, c 195]</p>`
    );
    const parsed = parseSection(html, "HRS_0026-0012.htm", "https://x/HRS_0026-0012.htm");
    expect(parsed.title).toBe("Department of education.");
    expect(parsed.bodyText.startsWith("(a) The department of education")).toBe(true);
  });

  test("real connectors in a split heading still work", () => {
    const html = page(
      `<p class="RegularParagraphs"><b>&nbsp; §1</b>-<b>2&nbsp; Certain laws.</b>&nbsp; No written law.</p>`
    );
    const parsed = parseSection(html, "HRS_0001-0002.htm", "https://x/HRS_0001-0002.htm");
    expect(parsed.sectionNumber).toBe("§1-2");
    expect(parsed.title).toBe("Certain laws.");
  });
});

describe("bracketed chapter banners", () => {
  const index = (body: string) =>
    parseChapterIndex(page(body), "HRS_0030-.htm", "https://x/HRS_0030-.htm", "30");

  test("a bracketed banner still yields the title", () => {
    const parsed = index(
      `<p class="RegularParagraphs">[CHAPTER 30]</p>
       <p class="RegularParagraphs">[CHAPTER 30]</p>
       <p class="RegularParagraphs">GUBERNATORIAL TRANSITION</p>
       <p class="RegularParagraphs">Section</p>
       <p class="RegularParagraphs">30-1 Declaration of purpose</p>`
    );
    expect(parsed.title).toBe("GUBERNATORIAL TRANSITION");
  });

  test("a title inside the bracket is taken from the banner itself", () => {
    const parsed = index(
      `<p class="RegularParagraphs">House Bill</p>
       <p class="RegularParagraphs">[CHAPTER 56 PUBLIC OFF-STREET PARKING FACILITIES]</p>
       <p class="RegularParagraphs">Section</p>
       <p class="RegularParagraphs">56-1 Authorization by the council</p>`
    );
    expect(parsed.title).toBe("PUBLIC OFF-STREET PARKING FACILITIES");
  });

  test("an unbracketed banner is unchanged", () => {
    const parsed = index(
      `<p class="RegularParagraphs">CHAPTER 30</p>
       <p class="RegularParagraphs">GUBERNATORIAL TRANSITION</p>
       <p class="RegularParagraphs">Section</p>`
    );
    expect(parsed.title).toBe("GUBERNATORIAL TRANSITION");
  });
});

test("a chapter title may begin with a digit", () => {
  const parsed = parseChapterIndex(
    page(
      `<p class="RegularParagraphs">CHAPTER 138</p>
       <p class="RegularParagraphs">911 SERVICES</p>
       <p class="RegularParagraphs">Section</p>
       <p class="RegularParagraphs">138-1 Definitions</p>`
    ),
    "HRS_0138-.htm",
    "https://x/HRS_0138-.htm",
    "138"
  );
  expect(parsed.title).toBe("911 SERVICES");
});

test("the section listing is still not mistaken for a title", () => {
  const parsed = parseChapterIndex(
    page(
      `<p class="RegularParagraphs">CHAPTER 30</p>
       <p class="RegularParagraphs">30-1 Declaration of purpose</p>`
    ),
    "HRS_0030-.htm",
    "https://x/HRS_0030-.htm",
    "30"
  );
  expect(parsed.title).toBe("");
});

test("a subsection marker split across runs is still stripped", () => {
  // Word writes `(`, `a`, `)` as three separate runs, so no single run looks
  // like a marker.
  const html = page(
    `<p class="RegularParagraphs"><b>[§305J-3]<span> Applicability of chapter; exceptions. </span></b>` +
      `<b><span> </span></b><span>(</span>a<span>)<b> </b>This chapter shall not apply.</span></p>`
  );
  const parsed = parseSection(html, "HRS_0305J-0003.htm", "https://x/HRS_0305J-0003.htm");
  expect(parsed.title).toBe("Applicability of chapter; exceptions.");
  expect(parsed.bodyText.startsWith("(a) This chapter shall not apply")).toBe(true);
});

test("a title that is itself parenthesised survives", () => {
  const html = page(`<p class="RegularParagraphs"><b>§88-53 (Reserved)</b></p>`);
  expect(parseSection(html, "HRS_0088-0053.htm", "https://x/y").title).toBe("(Reserved)");
});

test("a superseded [OLD] chapter banner does not become the title", () => {
  const parsed = parseChapterIndex(
    page(
      `<p class="RegularParagraphs">CHAPTER 11 [OLD]</p>
       <p class="RegularParagraphs">VOTER REGISTRATION</p>
       <p class="RegularParagraphs">CHAPTER 11</p>
       <p class="RegularParagraphs">ELECTIONS, GENERALLY</p>
       <p class="RegularParagraphs">Section</p>`
    ),
    "HRS_0011-.htm",
    "https://x/HRS_0011-.htm",
    "11"
  );
  expect(parsed.title).toBe("ELECTIONS, GENERALLY");
});

test("a [NEW] marker is a status, not a chapter title", () => {
  const parsed = parseChapterIndex(
    page(
      `<p class="RegularParagraphs">CHAPTER 14 [OLD]</p>
       <p class="RegularParagraphs">ABSENTEE VOTING</p>
       <p class="RegularParagraphs">CHAPTER 14 [NEW]</p>
       <p class="RegularParagraphs">PRESIDENTIAL ELECTIONS</p>`
    ),
    "HRS_0014-.htm",
    "https://x/HRS_0014-.htm",
    "14"
  );
  expect(parsed.title).toBe("PRESIDENTIAL ELECTIONS");
});

describe("parseTitleBanner", () => {
  const p = (cls: string, text: string) => `<p class="${cls}">${text}</p>`;
  const R = (text: string) => p("RegularParagraphs", text);

  test("returns null for the 1,067 index pages with no TITLE banner", () => {
    const html = page(`${R("<b>CHAPTER 431K</b>")}${R("<b>RISK RETENTION</b>")}${R("Section")}`);
    expect(parseTitleBanner(html)).toBeNull();
  });

  // The shapes seen across the 41 pages, in one fixture: a DIVISION banner, a
  // title name and a subtitle name and a row that each wrap into the next
  // paragraph, notes in the middle, and the title's material ending at the
  // first CHAPTER line even when that one is a superseded [OLD] banner.
  test("reads division, title, subtitles, wrapped rows and title notes", () => {
    const html = page(
      R("<b>DIVISION 1.&nbsp; GOVERNMENT</b>") +
        R("<b>TITLE 6.&nbsp; COUNTY ORGANIZATION</b>") +
        R("<b>AND ADMINISTRATION</b>") +
        R("Subtitle 1. Provisions Common to All") +
        R("Counties") +
        R("Chapter") +
        R("46 General Provisions") +
        R("47C Indebtedness of the Counties, Exclusions from") +
        R("the Funded Debt, and Certification Thereof") +
        R("Subtitle 2. Honolulu Government") +
        R("70 General Provisions Relating to Honolulu--Repealed") +
        p("XNotesHeading", "Revision Note") +
        p("XNotes", "Throughout this title, references to \"board of supervisors\" mean the council.") +
        R("<b>CHAPTER 46 [OLD]</b>") +
        R("<b>CHAPTER 46</b>") +
        R("<b>GENERAL PROVISIONS</b>") +
        R("Section") +
        R("46-1 Definitions")
    );
    const t = parseTitleBanner(html)!;
    expect(t.division).toEqual({ number: 1, name: "GOVERNMENT" });
    expect(t.number).toBe("6");
    expect(t.name).toBe("COUNTY ORGANIZATION AND ADMINISTRATION");
    expect(t.supplied).toBe(false);
    expect(t.listing).toEqual([
      {
        subtitle: "Subtitle 1. Provisions Common to All Counties",
        chapters: [
          { number: "46", name: "General Provisions" },
          {
            number: "47C",
            name: "Indebtedness of the Counties, Exclusions from the Funded Debt, and Certification Thereof",
          },
        ],
      },
      {
        subtitle: "Subtitle 2. Honolulu Government",
        chapters: [{ number: "70", name: "General Provisions Relating to Honolulu--Repealed" }],
      },
    ]);
    expect(t.annotations).toEqual([
      { heading: "Revision Note", text: 'Throughout this title, references to "board of supervisors" mean the council.' },
    ]);
    // The chapter's own material is not the title's.
    expect(JSON.stringify(t)).not.toContain("46-1");
    expect(JSON.stringify(t)).not.toContain("OLD");
  });

  test("a bracketed banner is revisor-supplied, and only the first title of a division carries one", () => {
    const html = page(
      R("<b>[TITLE 23A.&nbsp; OTHER BUSINESS ENTITIES]</b>") +
        R("Chapter") +
        R("428 Uniform Limited Liability Company Act") +
        R("<b>CHAPTER 428</b>")
    );
    const t = parseTitleBanner(html)!;
    expect(t.division).toBeUndefined();
    expect(t.number).toBe("23A");
    expect(t.name).toBe("OTHER BUSINESS ENTITIES");
    expect(t.supplied).toBe(true);
    expect(t.listing).toEqual([{ chapters: [{ number: "428", name: "Uniform Limited Liability Company Act" }] }]);
  });

  // Title 37 puts its codification note between the banner and the `Chapter`
  // header, with no heading, and titles 37 and 38 close the table with an
  // appendix listing that is not a chapter.
  test("headingless notes are prose, and an appendix ends the listing", () => {
    const html = page(
      R("<b>DIVISION 5.&nbsp; CRIMES AND CRIMINAL PROCEEDINGS</b>") +
        R("<b>TITLE 37.&nbsp; HAWAII PENAL CODE</b>") +
        p("XNotes", "Codification. Act 9, Session Laws 1972, repealed or recodified the criminal laws.") +
        R("Chapter") +
        R("701 Preliminary Provisions") +
        R("713 Repeal and Recodification Provisions") +
        R("Appendix") +
        R("1. Abbreviations") +
        R("<b>CHAPTER 701</b>")
    );
    const t = parseTitleBanner(html)!;
    expect(t.notes).toBe("Codification. Act 9, Session Laws 1972, repealed or recodified the criminal laws.");
    expect(t.annotations).toEqual([]);
    expect(t.listing[0]!.chapters.map((c) => c.name)).toEqual([
      "Preliminary Provisions",
      "Repeal and Recodification Provisions",
    ]);
  });
});
