import { expect, test, describe } from "bun:test";
import {
  chapterLabel,
  chapterPage,
  homePage,
  outline,
  partBanner,
  searchPage,
  sectionPage,
  volumePage,
} from "./site";
import { sectionHref, type Index, type Target } from "./resolver";
import type { ParsedSection } from "./config";
import type { Edge } from "./graph";

const target = (number: string, title: string): Target => ({
  number,
  kind: "section",
  title,
  href: sectionHref(number),
});

const index: Index = {
  sections: new Map([
    ["343-7", target("§343-7", "Limitation of actions.")],
    ["201H-205", target("§201H-205", "Additional powers.")],
    ["26-34", target("§26-34", "Boards and commissions.")],
    ["502-13", target("§502-13", "Registration.")],
  ]),
  chapters: new Map([
    ["23G", { number: "23G", kind: "chapter", title: "LEGISLATIVE REFERENCE BUREAU", href: "/hrs/chapter/23G" }],
    ["91", { number: "91", kind: "chapter", title: "ADMINISTRATIVE PROCEDURE", href: "/hrs/chapter/91" }],
    // Present so that a citation to a missing section *in* it classifies as
    // `absent-section` rather than `unresolved`.
    ["502", { number: "502", kind: "chapter", title: "CONVEYANCES", href: "/hrs/chapter/502" }],
  ]),
  aliases: new Map(),
};

const section = (over: Partial<ParsedSection> = {}): ParsedSection => ({
  sectionNumber: "§502-13",
  title: "Registration.",
  bodyText: "",
  bodyHtml: "",
  history: "",
  crossReferences: [],
  caseNotes: "",
  annotations: [],
  partHeading: null,
  chapterNumber: "502",
  docType: "hrs",
  isUncodified: false,
  isRepealed: false,
  covers: null,
  titleIsSupplied: false,
  sourceAnomalies: [],
  numberSource: "page",
  filename: "HRS_0502-0013.htm",
  url: "https://x/HRS_0502-0013.htm",
  ...over,
});

const render = (over: Partial<ParsedSection> = {}, citedBy?: Edge[]) =>
  sectionPage(section(over), { chapterLabel: "Chapter 502", volume: 12, citedBy }, index);

describe("legislative history is never linked", () => {
  // Measured over the corpus: of 5,222 resolvable citations in history, 4,251
  // point at the citing section's own page and 971 point somewhere else — and
  // all 971 are wrong. History cites the compilations a section used to live
  // in, not today's code. See docs/citation-linking.md, hazard 9.
  test("a superseded-compilation citation stays plain text", () => {
    const html = render({ history: "[L 1903, c 30; RL 1945, §12716; RL 1955, §343-7; HRS §502-13]" });
    expect(html).toContain("RL 1955, §343-7");
    // §343-7 exists in the index and would otherwise resolve to "Limitation of
    // actions", which is not what this section's 1955 number means.
    expect(html).not.toContain(sectionHref("§343-7"));
  });

  test("a self-referential HRS marker is not linked either", () => {
    const html = render({ history: "[L 1955, c 1, §1; HRS §502-13]" });
    expect(html).toContain("HRS §502-13");
    expect(html).not.toContain(`href="${sectionHref("§502-13")}"`);
  });

  test("history is still escaped", () => {
    const html = render({ history: "[am L 1972, c 88 <b>&</b> c 90]" });
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});

describe("section titles are linkified", () => {
  // 29 titles in the corpus are themselves citations, and on 23 of them it is
  // the page's only content. Escaping the title leaves the reader at a dead end
  // exactly where the pointer is the whole point.
  test("a 'Renumbered as' title becomes a working link", () => {
    const html = sectionPage(
      section({
        sectionNumber: "§201H-210",
        title: "Renumbered as §201H-205.",
        chapterNumber: "201H",
      }),
      { chapterLabel: "Chapter 201H", volume: 4 },
      index
    );
    expect(html).toContain(`href="${sectionHref("§201H-205")}"`);
    expect(html).toContain("Additional powers");
  });

  test("an ordinary title is left alone", () => {
    expect(render({ title: "Registration." })).toContain(
      '<span class="num">§502-13</span> Registration.'
    );
  });
});

describe("body text", () => {
  test("resolved citations are linked with the target's title as the accessible name", () => {
    const html = render({ bodyText: "Subject to section 26-34, the board shall act." });
    expect(html).toContain(`href="${sectionHref("§26-34")}"`);
    expect(html).toContain('aria-label="section 26-34, Boards and commissions"');
  });

  test("a citation into a chapter that exists but a section that does not is marked, not linked", () => {
    const html = render({ bodyText: "as provided in section 502-999." });
    expect(html).toContain('<span class="absent">section 502-999');
    expect(html).toContain("(not in the current code)");
    expect(html).not.toContain('href="/hrs/502-999"');
  });

  test("a bare number is never treated as a section reference", () => {
    const html = render({ bodyText: "under section 203 of that Act." });
    expect(html).not.toContain("<a href=\"/hrs/203\"");
  });
});

describe("statutory outline", () => {
  const depths = (ps: string[]) => outline(ps).map((r) => r.depth);

  test("nests (a) -> (1) and pops back out", () => {
    expect(
      depths([
        "Introductory text:",
        "(a) First subsection.",
        "(1) A paragraph.",
        "(2) Another paragraph.",
        "(b) Second subsection.",
      ])
    ).toEqual([0, 1, 2, 2, 1]);
  });

  // Many sections start at (1) with no (a) above them. A fixed marker->depth
  // table would indent those as though a level were missing.
  test("a section starting at (1) is depth 1, not depth 2", () => {
    expect(depths(["The revisor may:", "(1) Number chapters;", "(2) Rearrange sections;"])).toEqual(
      [0, 1, 1]
    );
  });

  test("all four levels nest", () => {
    expect(
      depths(["(a) One.", "(1) Two.", "(A) Three.", "(i) Four.", "(ii) Four again.", "(b) Back."])
    ).toEqual([1, 2, 3, 4, 4, 1]);
  });

  // (i) is both the ninth letter and the first roman numeral. Following (h) it
  // is a letter; with no lowercase level open it is a roman.
  test("(i) after (h) continues the lowercase level", () => {
    expect(depths(["(g) G.", "(h) H.", "(i) I.", "(j) J."])).toEqual([1, 1, 1, 1]);
  });

  test("(i) with no lowercase run before it opens a roman level", () => {
    expect(depths(["(1) One.", "(A) Two.", "(i) Three."])).toEqual([1, 2, 3]);
  });

  test("an unmarked paragraph keeps the current depth", () => {
    expect(depths(["(a) One.", "(1) Two.", "Continuation of two.", "(2) Three."])).toEqual([
      1, 2, 2, 2,
    ]);
  });

  test("depth becomes an indentation class, and level 0 gets none", () => {
    const html = sectionPage(
      section({ bodyText: "Intro:\n\n(a) First.\n\n(1) Nested." }),
      { chapterLabel: "Chapter 502", volume: 12 },
      index
    );
    expect(html).toContain("<p>Intro:</p>");
    expect(html).toContain('<p class="lv1">(a) First.</p>');
    expect(html).toContain('<p class="lv2">(1) Nested.</p>');
  });

  test("annotations are not outlined", () => {
    const html = sectionPage(
      section({ annotations: [{ heading: "Case Notes", text: "(1) A numbered note." }] }),
      { chapterLabel: "Chapter 502", volume: 12 },
      index
    );
    expect(html).toContain('<p class="ann">(1) A numbered note.</p>');
  });
});

describe("chapter pages", () => {
  // partHeading marks only where a part begins; it is null on every section
  // after the first. Treating null as a change starts a fresh, unlabelled list
  // under each part's first section.
  test("a part heading carries forward across sections that do not repeat it", () => {
    const sections = [
      section({ sectionNumber: "§26-1", title: "One.", chapterNumber: "26", partHeading: "PART I. ORGANIZATION" }),
      section({ sectionNumber: "§26-2", title: "Two.", chapterNumber: "26" }),
      section({ sectionNumber: "§26-3", title: "Three.", chapterNumber: "26" }),
      section({ sectionNumber: "§26-4", title: "Four.", chapterNumber: "26", partHeading: "PART II. OTHER" }),
    ];
    const html = chapterPage("26", { title: "DEPARTMENTS", volume: 1 }, 1, sections, index);
    expect(html.match(/<ol class="toc">/g)).toHaveLength(2);
    expect(html.match(/class="part"/g)).toHaveLength(2);
  });

  // 293 chapters have no sections at all. Without the index page's own notes
  // these pages would say nothing.
  test("a chapter with no sections still renders its notes and annotations", () => {
    const html = chapterPage(
      "2",
      {
        title: "STATUTE REVISION",
        volume: 1,
        notes: "REPEALED. L Sp 1977 1st, c 8, §3.",
        annotations: [{ heading: "Cross References", text: "For present provisions, see chapter 23G, pt. II." }],
      },
      1,
      [],
      index
    );
    expect(html).toContain("REPEALED. L Sp 1977 1st, c 8, §3.");
    expect(html).toContain('href="/hrs/chapter/23G"');
    // A bare "0 sections" reads like a build failure.
    expect(html).not.toContain("0 sections");
  });

  test("the non-HRS directories are labelled rather than called chapters", () => {
    expect(chapterLabel("05-CONST")).toBe("Hawaii State Constitution");
    expect(chapterLabel("26", { title: "DEPARTMENTS", volume: 1 })).toBe("Chapter 26 — DEPARTMENTS");
  });
});

describe("bracketed headings", () => {
  // "not yet codified" was an interpretation nothing in the corpus supports:
  // 7,859 sections (33.6%) carry a bracketed heading and are plainly printed in
  // the HRS. The Revision Notes say brackets mark revisor-supplied material.
  test("a bracketed heading is described as revisor-supplied, not uncodified", () => {
    const html = render({ isUncodified: true });
    expect(html).toContain("heading supplied by the revisor");
    expect(html).not.toContain("codified");
  });

  test("a bracketed catchline is described the same way", () => {
    expect(render({ titleIsSupplied: true })).toContain("catchline supplied by the revisor");
  });

  // The label is scoped to the heading on purpose — the statute's text is
  // enacted law either way, and "not enacted" would invite the wrong reading.
  test("the label makes no claim about the statute's force", () => {
    const html = render({ isUncodified: true, bodyText: "The department shall act." });
    expect(html).not.toContain("not enacted");
    expect(html).toContain("The department shall act.");
  });
});

describe("part banners", () => {
  // Left in, the brackets read as a rendering artifact. They come off and the
  // fact is stated in words — the same trade the parser already makes for a
  // bracketed section heading.
  test("an unbracketed banner renders plainly", () => {
    const html = partBanner("PART V. GENERAL FUND EXPENDITURE CEILING");
    expect(html).toBe('<p class="part">PART V. GENERAL FUND EXPENDITURE CEILING</p>');
  });

  test("a fully bracketed banner loses the brackets and gains the note", () => {
    const html = partBanner("[PART IV. THE EXECUTIVE BUDGET]");
    expect(html).toContain(">PART IV. THE EXECUTIVE BUDGET<");
    expect(html).not.toContain("[");
    expect(html).toContain("supplied by the revisor");
  });

  test("a partly bracketed banner is handled the same way", () => {
    const html = partBanner("[PART VII.] ROUTINE REPAIR AND MAINTENANCE");
    expect(html).toContain(">PART VII. ROUTINE REPAIR AND MAINTENANCE<");
    expect(html).toContain("supplied by the revisor");
  });

  test("the banner reaches the section page through the same path", () => {
    expect(render({ partHeading: "[ARTICLE 9J]" })).toContain(">ARTICLE 9J<");
  });
});

describe("source links", () => {
  // Section pages carried one and nothing else did, which made every other page
  // look like a different site.
  test("a section page links its source file", () => {
    expect(render()).toContain('<a href="https://x/HRS_0502-0013.htm">HRS_0502-0013.htm</a>');
  });

  test("a chapter page links its index page", () => {
    const html = chapterPage("37", { title: "BUDGET", volume: 1 }, 1, [], index, {
      url: "https://x/HRS_0037-.htm",
      filename: "HRS_0037-.htm",
    });
    expect(html).toContain('<a href="https://x/HRS_0037-.htm">HRS_0037-.htm</a>');
  });

  // 02-HNP and 03-ORG have no index page on the source server.
  test("a chapter with no index page gets no footer rather than a dead link", () => {
    const html = chapterPage("02-HNP", undefined, 1, [], index);
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("Source:");
  });

  test("a volume page links its directory", () => {
    const html = volumePage(1, "1–42F", [], { url: "https://x/Vol01/", dirName: "Vol01" });
    expect(html).toContain('<a href="https://x/Vol01/">Vol01</a>');
  });
});

describe("cited by", () => {
  const edges = (n: number, block: "body" | "annotation" | "range" = "body") =>
    Array.from({ length: n }, (_, i) => ({
      from: `§26-${i + 1}`,
      to: "§502-13",
      kind: "section" as const,
      block,
    }));

  test("a short list renders open, with a count", () => {
    const html = render({}, edges(3));
    expect(html).toContain("<h2>Cited by</h2>");
    expect(html).toContain("3 sections");
    expect(html).not.toContain("<details>");
    expect(html).toContain(`href="${sectionHref("§26-1")}"`);
  });

  test("one citing section is singular", () => {
    expect(render({}, edges(1))).toContain("1 section");
  });

  // §23G-15 has 410 citing sections and chapter 91 has 1,642. Rendering those
  // flat buries the statute under its own backlinks.
  test("a long list collapses into native details/summary", () => {
    const html = render({}, edges(40));
    expect(html).toContain("<details><summary>40 sections</summary>");
    expect(html).not.toContain("<script");
  });

  test("statutory and annotation references are separated", () => {
    const html = render({}, [...edges(2), ...edges(2, "annotation")]);
    expect(html).toContain("<h2>Cited by</h2>");
    expect(html).toContain("<h2>Mentioned in annotations</h2>");
  });

  // The statute meant the whole span, but no text in it names this section.
  test("a range-implied reference is marked", () => {
    expect(render({}, edges(1, "range"))).toContain("within a cited range");
  });

  test("nothing is rendered when nothing cites the section", () => {
    expect(render()).not.toContain("Cited by");
  });
});

describe("search index markup", () => {
  // Once any page carries data-pagefind-body, Pagefind indexes only those pages.
  // Statute and chapter pages are content; volume and home pages are navigation
  // and would only pollute results.
  test("section pages are indexed, with metadata and filters", () => {
    const html = render();
    expect(html).toContain("data-pagefind-body");
    expect(html).toContain('data-pagefind-meta="number:§502-13"');
    expect(html).toContain('data-pagefind-filter="chapter:502"');
    expect(html).toContain('data-pagefind-filter="status:in force"');
  });

  test("a repealed section is filterable as such", () => {
    expect(render({ isRepealed: true })).toContain('data-pagefind-filter="status:repealed"');
  });

  test("chapter pages are indexed", () => {
    expect(chapterPage("37", { title: "BUDGET", volume: 1 }, 1, [], index)).toContain(
      "data-pagefind-body"
    );
  });

  test("navigation pages are not indexed", () => {
    expect(volumePage(1, "1–42F", [])).not.toContain("data-pagefind-body");
    expect(homePage([], { sections: 0, chapters: 0 })).not.toContain("data-pagefind-body");
  });

  // Annotations are 5.3M characters against the statutes' 32M but concentrated
  // on a minority of sections; at equal weight the case law discussing a section
  // outranks the section itself.
  test("annotations are down-weighted", () => {
    expect(render({ annotations: [{ heading: "Case Notes", text: "A note." }] })).toContain(
      'data-pagefind-weight="0.4"'
    );
  });

  // Otherwise every heavily-cited section matches every query naming one of the
  // sections that cites it.
  test("backlinks are excluded from the index", () => {
    const html = render({}, [{ from: "§26-1", to: "§502-13", kind: "section", block: "body" }]);
    expect(html).toContain("data-pagefind-ignore");
  });
});

describe("search page", () => {
  test("it is the only page that loads JavaScript", () => {
    const html = searchPage();
    expect(html).toContain("pagefind-ui.js");
    expect(render()).not.toContain("<script");
  });

  test("it degrades to real guidance without JavaScript", () => {
    const html = searchPage();
    expect(html).toContain("<noscript>");
    expect(html).toContain("Search needs JavaScript");
    expect(html).toContain('href="/"');
  });

  test("it is not itself indexed", () => {
    expect(searchPage()).not.toContain("data-pagefind-body");
  });

  test("every page offers a way to reach it", () => {
    expect(render()).toContain('href="/search"');
    expect(chapterPage("37", undefined, 1, [], index)).toContain('href="/search"');
  });
});

describe("page shell", () => {
  test("no JavaScript is emitted", () => {
    const html = render({ bodyText: "Text.", annotations: [{ heading: "Case Notes", text: "A note." }] });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
  });

  test("the breadcrumb marks the current page and links its ancestors", () => {
    const html = render();
    expect(html).toContain('<li><a href="/hrs/volume/12">Volume 12</a></li>');
    expect(html).toContain('<li aria-current="page">§502-13</li>');
  });

  test("a source anomaly is explained in the document flow, and the heading keeps the source's number", () => {
    const html = render({
      sectionNumber: "§634G-2",
      sourceAnomalies: [
        {
          field: "sectionNumber",
          observed: "§643G-2",
          corrected: "§634G-2",
          confidence: "conclusive",
          evidence: "Chapter 643G does not exist.",
        },
      ],
    });
    expect(html).toContain('<span class="num">§643G-2</span>');
    expect(html).toContain("Published here as §634G-2.");
  });
});
