import { expect, test, describe } from "bun:test";
import { detect, linkify, escapeHtml } from "./citations";
import { sectionSlug, type Index, type Target } from "./resolver";

/** A small hand-built index, so these tests do not depend on the corpus. */
function index(sections: string[], chapters: string[] = [], aliases: [string, string][] = []): Index {
  const target = (n: string, kind: "section" | "chapter"): Target => ({
    number: kind === "section" ? `§${n}` : n,
    kind,
    title: kind === "section" ? `Title of ${n}.` : `Chapter ${n}`,
    href: kind === "section" ? `/hrs/${sectionSlug(n)}` : `/hrs/chapter/${n}`,
  });
  return {
    sections: new Map(sections.map((n) => [n, target(n, "section")])),
    chapters: new Map(chapters.map((n) => [n, target(n, "chapter")])),
    aliases: new Map(aliases),
  };
}

const reasons = (text: string, idx: Index) =>
  detect(text, idx).map((c) => `${c.number}:${c.reason ?? "linked"}`);

describe("hazard 1 — the period", () => {
  const idx = index(["11-97", "6E-43.6", "6E-43"]);

  test("a sentence-ending period is not part of the number", () => {
    expect(reasons("under section 11-97. A person who violates", idx)).toEqual(["11-97:linked"]);
  });

  test("a decimal point is, when a digit follows", () => {
    expect(reasons("under section 6E-43.6 the department", idx)).toEqual(["6E-43.6:linked"]);
  });

  test("the compound case takes the decimal and leaves the full stop", () => {
    expect(reasons("see section 6E-43.6. The department", idx)).toEqual(["6E-43.6:linked"]);
  });
});

describe("hazard 2 — not every 'section N' is HRS", () => {
  test("a bare number is never an HRS section reference", () => {
    const idx = index(["203-1"], ["203"]);
    expect(reasons("section 203 of the Hawaiian Homes Commission Act, 1920", idx)).toEqual([
      "203:bare-number",
    ]);
  });

  test("a chapter next to a federal code is not an HRS chapter", () => {
    const idx = index([], ["11", "53"]);
    expect(reasons("chapter 11 of the Internal Revenue Code", idx)).toEqual(["11:foreign-law"]);
    expect(reasons("title 12 United States Code chapter 53, subchapter V", idx)).toEqual([
      "53:foreign-law",
    ]);
  });

  test("an ordinary chapter reference still links", () => {
    const idx = index([], ["91"]);
    expect(reasons("adopt rules pursuant to chapter 91", idx)).toEqual(["91:linked"]);
  });

  // Hawaii adopts uniform codes under their own names, so a name-based guard
  // misfires on them. A hyphenated section number is validated by the index.
  test("a uniform code adopted as HRS still links", () => {
    const idx = index(["490:1-201"]);
    expect(reasons("defined in section 490:1-201 of the Uniform Commercial Code", idx)).toEqual([
      "490:1-201:linked",
    ]);
  });
});

describe("hazard 3 — self-references", () => {
  test("'this section' is not a citation", () => {
    expect(detect("nothing in this section shall apply to this chapter", index([]))).toEqual([]);
  });
});

describe("hazard 4 — elided lists", () => {
  test("continues across commas and a trailing 'and'", () => {
    const idx = index(["92-3", "92-7", "92-9"]);
    expect(reasons("sections 92-3, 92-7, and 92-9 shall apply", idx)).toEqual([
      "92-3:linked",
      "92-7:linked",
      "92-9:linked",
    ]);
  });

  test("stops at the first token that is not citation-shaped", () => {
    const idx = index(["11-26", "11-51"]);
    const found = detect("sections 11-26 and 11-51, and the proceedings shall be had", idx);
    expect(found.map((c) => c.number)).toEqual(["11-26", "11-51"]);
  });

  // Decided 2026-09-09: link the endpoints, do not expand the span.
  test("a range links both endpoints and nothing between", () => {
    const idx = index(["11-1", "11-5", "11-9"]);
    const found = detect("sections 11-1 to 11-9 are repealed", idx);
    expect(found.map((c) => c.number)).toEqual(["11-1", "11-9"]);
    expect(found[1]!.rangeEndpoint).toBe(true);
  });
});

describe("hazard 6 — the article form", () => {
  test("colon numbers are detected and resolved", () => {
    const idx = index(["431:10A-104"]);
    expect(reasons("as defined in section 431:10A-104", idx)).toEqual(["431:10A-104:linked"]);
  });
});

describe("hazard 7 — Hawaii Administrative Rules", () => {
  // HAR is title-chapter-section, so its first two components are identical to
  // an HRS chapter-section number.
  test("a third component means the citation is not HRS", () => {
    const idx = index(["13-300"]);
    expect(reasons("This section and §13-300-51, Hawaii administrative rules", idx)).toEqual([
      "13-300:admin-rules",
    ]);
  });

  // HAR *chapters* are title-chapter, which looks exactly like an HRS section.
  // Resolving one as a section would be precisely the wrong link.
  test("a hyphenated number after 'chapter' is not an HRS chapter", () => {
    const idx = index(["12-13"], ["12"]);
    expect(reasons("after the director repealed HAR chapter 12-13", idx)).toEqual([
      "12-13:admin-rules",
    ]);
  });
});

describe("hazard 8 — superseded numbering", () => {
  test("an H.R.S. prefix marks the pre-1972 compilation", () => {
    const idx = index(["711-77"]);
    expect(reasons("See, e.g., H.R.S. §711-77.", idx)).toEqual(["711-77:superseded"]);
  });

  test("R.L.H. likewise", () => {
    const idx = index(["57-43"]);
    expect(reasons("in note to R.L.H. 1955, §57-43", idx)).toEqual(["57-43:superseded"]);
  });
});

describe("resolution", () => {
  test("a shaped-but-absent number is unresolved, not linked", () => {
    expect(reasons("under section 445-222 and any other", index([]))).toEqual([
      "445-222:unresolved",
    ]);
  });

  test("a corrected number resolves through the ledger alias", () => {
    const idx = index(["634G-2"], [], [["§643G-2", "§634G-2"]]);
    const found = detect("as provided in section 643G-2", idx);
    expect(found[0]!.target?.number).toBe("§634G-2");
  });
});

describe("linkify", () => {
  const idx = index(["26-34"]);

  test("links resolved citations and leaves the text otherwise intact", () => {
    const html = linkify("as provided in section 26-34. The term", idx);
    expect(html).toContain('<a href="/hrs/26-34"');
    expect(html).toContain(">section 26-34</a>. The term");
  });

  // The visible text is the citation; the accessible name carries the title so a
  // screen-reader user scanning links does not meet a wall of bare numbers.
  test("carries the target title in the accessible name", () => {
    expect(linkify("see section 26-34", idx)).toContain('aria-label="section 26-34, Title of 26-34"');
  });

  test("unresolved citations stay plain text — no dead links", () => {
    const html = linkify("see section 999-1 and section 26-34", idx);
    expect(html).toContain("see section 999-1 and");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  test("escapes markup in the surrounding text", () => {
    expect(linkify("a < b & section 26-34", idx)).toStartWith("a &lt; b &amp; ");
  });

  test("escapeHtml covers the delimiters", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

describe("slugs", () => {
  test("the article colon becomes a hyphen", () => {
    expect(sectionSlug("§431:1-100")).toBe("431-1-100");
  });

  test("ordinary numbers pass through", () => {
    expect(sectionSlug("§26-34")).toBe("26-34");
    expect(sectionSlug("§11-1.52")).toBe("11-1.52");
  });

  test("the [OLD] variant gets its own slug", () => {
    expect(sectionSlug("§431:9A-101 [OLD]")).toBe("431-9A-101-old");
  });
});
