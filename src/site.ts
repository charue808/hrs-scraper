/**
 * The site's markup.
 *
 * Split from the build driver so the rules that matter — what gets linked, what
 * deliberately does not, and how the structure is grouped — can be tested
 * without running a 24,500-file build. `build.ts` owns reading the corpus and
 * writing files; this file owns what a page looks like.
 *
 * Pages are rendered from the structured fields, never from `bodyHtml`. The
 * only script a statute page carries is the inline theme switch (`THEME_SCRIPT`),
 * which the markup never depends on.
 */
import {
  type Annotation,
  type ChapterRecord,
  type ParsedSection,
  type TitleRecord,
} from "./config";
import { escapeHtml, linkify } from "./citations";
import { chapterHref, resolve, sectionHref, titleHref, volumeHref, type Index } from "./resolver";
import { properCitation } from "./cross-document";
import type { Edge } from "./graph";

/**
 * The six non-HRS directories, whose chapter index pages carry no chapter
 * banner to take a title from. Their sections are headed with proper citations
 * (`properCitation` in cross-document.ts); this labels the directory itself.
 */
export const NON_HRS_LABELS: Record<string, string> = {
  "01-USCON": "United States Constitution",
  "02-HNP": "Hawaii National Park Act",
  "03-ORG": "Organic Act",
  "04-ADM": "Admission Act",
  "05-CONST": "Hawaii State Constitution",
  "06-HHCA": "Hawaiian Homes Commission Act",
};

// --- markup ---

/**
 * The dark palette, applied two ways: when the system asks for it and the
 * reader has not said otherwise, and when the reader has chosen it. Written
 * once so the two cannot drift.
 */
const DARK = `color-scheme: dark; --ink:#e8e6e1; --muted:#a6a29a; --rule:#3a3733; --bg:#16150f;
          --note-bg:#241f14; --note-edge:#b58900; --accent:#d9b74a;`;

export const STYLE = `
:root { color-scheme: light; --ink:#1a1a1a; --muted:#5a5a5a; --rule:#d8d4cc; --bg:#fbfaf7;
        --note-bg:#fdf6e3; --note-edge:#b58900; --accent:#7a5c00; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { ${DARK} }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
       font:16px/1.65 Georgia, 'Times New Roman', serif; }
.wrap { max-width: 44rem; margin: 0 auto; padding: 0 1rem; }
main { padding-bottom: 2rem; }
h1 { font-size: 1.45rem; line-height:1.3; margin:1.5rem 0 .5rem; }
h2 { font-size: .95rem; text-transform: uppercase; letter-spacing:.06em;
     margin:2rem 0 .5rem; color: var(--muted); font-family: system-ui, sans-serif; }
p { margin: 0 0 1rem; }
.num { font-family: system-ui, sans-serif; font-weight:700; }
a { color: inherit; text-decoration: underline; text-underline-offset: 2px;
    text-decoration-color: var(--accent); text-decoration-thickness: 2px; }
a:hover, a:focus { background: var(--note-bg); }
.meta { color: var(--muted); font-size:.85rem; font-family: system-ui, sans-serif; }
.history { color: var(--muted); font-size:.9rem; }
.part { font-family: system-ui, sans-serif; font-size:.8rem; letter-spacing:.06em;
        text-transform: uppercase; color: var(--muted); margin: 1.5rem 0 .25rem; }
/* The banner is uppercased; the editorial note about it is not. */
.part .supplied { text-transform: none; letter-spacing: 0; font-style: italic; opacity: .85; }
.note { background: var(--note-bg); border-left: 4px solid var(--note-edge);
        padding:.75rem 1rem; margin:1rem 0; font-size:.92rem; }
.note strong { font-family: system-ui, sans-serif; }
.ann { font-size:.94rem; }
/* Statutory outline depth. The enumerators (a) (1) (A) (i) are enacted text and
   stay visible, so structure is carried by indentation, not by list markers.
   Steps stay modest so four levels still fit a phone. */
.lv1 { margin-left: 1.3rem; }
.lv2 { margin-left: 2.6rem; }
.lv3 { margin-left: 3.9rem; }
.lv4 { margin-left: 5.2rem; }
@media (max-width: 30rem) {
  .lv1 { margin-left: .7rem; } .lv2 { margin-left: 1.4rem; }
  .lv3 { margin-left: 2.1rem; } .lv4 { margin-left: 2.8rem; }
}
/* A citation into the HRS whose section is no longer in the code. Marked, not
   linked: a dotted underline is the non-color affordance (WCAG 1.4.1), and the
   clarification is real text for assistive technology. */
.absent { border-bottom: 1px dotted var(--muted); }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
           overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
.skip { position:absolute; left:-9999px; }
.skip:focus { left:.5rem; top:.5rem; position:fixed; background:var(--bg);
              padding:.5rem .75rem; border:2px solid var(--accent); z-index:10; }
ul.toc, ol.toc { list-style:none; padding:0; margin:0; }
ul.toc li, ol.toc li { border-bottom:1px solid var(--rule); }
ul.toc a, ol.toc a { display:block; padding:.55rem .25rem; text-decoration:none; }
ul.toc a:hover, ol.toc a:hover, ul.toc a:focus, ol.toc a:focus { background:var(--note-bg); }
ol.toc .t { color: var(--muted); }
.repealed .t::after { content:" — repealed"; font-size:.85em; }
details summary { cursor: pointer; padding:.4rem 0; font-family: system-ui, sans-serif;
                  font-size:.85rem; color: var(--muted); }
details summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
nav.crumbs { border-bottom:1px solid var(--rule); font-size:.82rem;
             font-family: system-ui, sans-serif; }
nav.crumbs ol { list-style:none; display:flex; flex-wrap:wrap; gap:.5rem;
                padding:.75rem 0; margin:0; color: var(--muted); }
nav.crumbs li + li::before { content:"› "; color: var(--rule); }
nav.crumbs > .wrap { display:flex; align-items:baseline; justify-content:space-between; gap:1rem; }
nav.crumbs .tools { display:flex; align-items:baseline; gap:.75rem; white-space:nowrap; font-size:.82rem; }
/* The theme switch. Only ever created by the script, so a page without one
   simply has no button — the system preference still applies. */
button.theme { font:inherit; color:inherit; background:none; cursor:pointer;
               border:1px solid var(--rule); border-radius:4px; padding:.1rem .5rem; }
button.theme:hover, button.theme:focus-visible { background:var(--note-bg); border-color:var(--accent); }
button.theme[aria-pressed="true"] { border-color:var(--accent); }
/* Pagefind's UI inherits the page palette rather than shipping its own. */
:root { --pagefind-ui-scale:.8; --pagefind-ui-primary:var(--ink);
        --pagefind-ui-text:var(--ink); --pagefind-ui-background:var(--bg);
        --pagefind-ui-border:var(--rule); --pagefind-ui-tag:var(--note-bg);
        --pagefind-ui-font:system-ui, sans-serif; }
/* padding-block, not the shorthand: this rule outranks .wrap and the shorthand
   would zero the side gutter — which is invisible on a desktop, where max-width
   centres the bar, and flush against the edge on a phone. */
nav.pager { border-top:1px solid var(--rule); display:flex; gap:1rem;
            justify-content:space-between; padding-block:1rem; font-size:.9rem; }
nav.pager a { flex:1 1 0; text-decoration:none; }
nav.pager .next { text-align:right; }
footer { border-top:1px solid var(--rule); padding:1rem 0 2rem; }
footer .disclaimer { font-size:.8rem; margin-top:.75rem; }
@media (max-width: 30rem) { nav.pager { flex-direction: column; }
                            nav.pager .next { text-align:left; } }
`;

/**
 * The one script every page carries — inline, ~20 lines, no request.
 *
 * It does two things: applies a stored theme choice before first paint, so a
 * reader who chose dark does not see a light flash, and adds the toggle to the
 * breadcrumb bar. The button exists only when the script runs — the markup
 * never references it — so with JavaScript off the page is exactly what it was:
 * the system preference decides, and nothing is missing that the reader could
 * have wanted to press. A choice overrides the system in both directions and
 * is remembered per browser in localStorage, where it stays the reader's.
 */
const THEME_SCRIPT = `<script>
(function () {
  var root = document.documentElement, KEY = "theme";
  var system = matchMedia("(prefers-color-scheme: dark)");
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  if (stored === "dark" || stored === "light") root.setAttribute("data-theme", stored);
  function isDark() {
    var t = root.getAttribute("data-theme");
    return t ? t === "dark" : system.matches;
  }
  addEventListener("DOMContentLoaded", function () {
    var tools = document.querySelector("nav.crumbs .tools");
    if (!tools) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "theme"; b.textContent = "Dark mode";
    b.setAttribute("aria-pressed", String(isDark()));
    b.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      b.setAttribute("aria-pressed", String(next === "dark"));
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
    tools.appendChild(b);
  });
})();
</script>`;

interface Crumb {
  label: string;
  href?: string;
}

/**
 * The title a chapter sits under, for the breadcrumb. Undefined for the
 * non-HRS documents, which are outside the Division/Title hierarchy — their
 * crumb goes straight from the top of the site to the document.
 */
export interface TitleRef {
  number: string;
  name: string;
}

/**
 * `HRS › Title 12 › …`. The site navigated by volume first, which is how the
 * printed edition is bound and means nothing to a citation; the title is the
 * hierarchy the code itself states, and what a lawyer would say.
 */
const topCrumbs = (title?: TitleRef): Crumb[] => [
  { label: "HRS", href: "/" },
  ...(title ? [{ label: `Title ${title.number}`, href: titleHref(title.number) }] : []),
];

/**
 * How a page presents itself to the search index.
 *
 * Pagefind indexes only pages carrying `data-pagefind-body` once any page has
 * it, which is exactly the behaviour we want: statute and chapter pages are
 * content, volume and home pages are navigation and would only pollute results.
 */
export interface SearchInfo {
  /** Shown on the result card. */
  meta?: Record<string, string>;
  /** Offered as facets in the search UI. */
  filters?: Record<string, string>;
}

const searchAttrs = (search?: SearchInfo): string => {
  if (!search) return "";
  const attr = (kind: "meta" | "filter", pairs: Record<string, string> = {}) =>
    Object.entries(pairs)
      .map(([k, v]) => ` data-pagefind-${kind}="${escapeHtml(`${k}:${v}`)}"`)
      .join("");
  return ` data-pagefind-body${attr("meta", search.meta)}${attr("filter", search.filters)}`;
};

export function page(opts: {
  title: string;
  crumbs: Crumb[];
  body: string;
  pager?: string;
  /** The source line, when the page has a document on the source server. */
  footer?: string;
  search?: SearchInfo;
  /**
   * Extra head markup, placed *before* the site stylesheet. Pagefind's CSS
   * defines its own `--pagefind-ui-*` defaults on `:root`, and the site's
   * overrides only win if they come later — otherwise dark mode gets Pagefind's
   * near-black text on the site's dark ground.
   */
  head?: string;
  bodyEnd?: string;
}): string {
  const crumbs = opts.crumbs
    .map((c) =>
      c.href
        ? `<li><a href="${c.href}">${escapeHtml(c.label)}</a></li>`
        : `<li aria-current="page">${escapeHtml(c.label)}</li>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
${opts.head ?? ""}<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${THEME_SCRIPT}
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<nav class="crumbs" aria-label="Breadcrumb"><div class="wrap"><ol>${crumbs}</ol>
<span class="tools"><a class="search-link" href="/search">Search</a></span></div></nav>
<main id="content" class="wrap"${searchAttrs(opts.search)}>
${opts.body}
</main>
${opts.pager ?? ""}
<footer class="wrap">${opts.footer ?? ""}${DISCLAIMER}</footer>
${opts.bodyEnd ?? ""}</body>
</html>
`;
}

/**
 * "Cited by" — the reverse of the citation graph.
 *
 * This is the thing the published statutes cannot do at all: a `.htm` file has
 * no idea what points at it. Two groups, because they answer different
 * questions:
 *
 * - **Cited by** — the statutory text of another section refers to this one.
 *   Range-implied edges belong here too (the statute did mean the whole span)
 *   but are marked, since there is no clickable text naming this section.
 * - **Mentioned in annotations** — case notes, commentary and revision notes
 *   discuss it. Useful, but not the statute pointing anywhere.
 *
 * Long lists are wrapped in `<details>`, which is native HTML — the no-JavaScript
 * rule is about scripts, not about interactivity the browser already provides.
 * §23G-15 is referenced by 410 sections and chapter 91 by 1,642; rendering those
 * flat would bury the statute under its own backlinks.
 */
const COLLAPSE_OVER = 25;

function citedByList(edges: Edge[], index: Index): string {
  const sortKey = (n: string) =>
    (n.match(/\d+|[A-Za-z]+/g) ?? []).map((p) => (/\d/.test(p) ? p.padStart(8, "0") : p)).join("");

  const rows = [...edges]
    .sort((a, b) => sortKey(a.from).localeCompare(sortKey(b.from)))
    .map((edge) => {
      const target =
        resolve(index, edge.from.replace(/^§/, ""), "section") ??
        [...(index.cross?.documents.values() ?? [])]
          .flatMap((m) => [...m.values()])
          .find((t) => t.number === edge.from);
      const title = target?.title ? `<span class="t">${escapeHtml(target.title)}</span>` : "";
      const note =
        edge.block === "range" ? `<span class="meta"> within a cited range</span>` : "";
      return (
        `<li><a href="${sectionHref(edge.from)}">` +
        `<span class="num">${escapeHtml(target?.label ?? edge.from)}</span> ${title}${note}</a></li>`
      );
    })
    .join("\n");

  return `<ul class="toc">${rows}</ul>`;
}

function citedBySection(edges: Edge[] | undefined, index: Index): string {
  if (!edges?.length) return "";

  const statutory = edges.filter((e) => e.block !== "annotation");
  const annotation = edges.filter((e) => e.block === "annotation");

  const group = (heading: string, list: Edge[], noun: string) => {
    if (!list.length) return "";
    const count = `${list.length} ${list.length === 1 ? noun : `${noun}s`}`;
    const body = citedByList(list, index);
    return list.length > COLLAPSE_OVER
      ? `<h2>${heading}</h2>\n<details><summary>${count}</summary>${body}</details>`
      : `<h2>${heading}</h2>\n<p class="meta">${count}</p>\n${body}`;
  };

  // Excluded from the search index: these are lists of other sections' numbers,
  // and indexing them makes every heavily-cited section match every query that
  // mentions one of its citers.
  return `<div data-pagefind-ignore>${[
    group("Cited by", statutory, "section"),
    group("Mentioned in annotations", annotation, "section"),
  ]
    .filter(Boolean)
    .join("\n")}</div>`;
}

/**
 * The link back to the published source for a page.
 *
 * Every page that stands for a real document on `capitol.hawaii.gov` carries
 * one, so a reader can always check this rendering against the original. It was
 * on section pages only until 2026-09-10, which made chapter, volume and home
 * pages look like a different site.
 *
 * `label` is the document as the source names it — a filename for a section or
 * chapter index, a directory for a volume.
 */
export function sourceFooter(url: string | undefined, label: string): string {
  if (!url) return "";
  return `<p class="meta">Source: <a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`;
}

/**
 * On every page, under the source line. The site is a copy, and the copy can
 * lag the official text by a legislative session; a reader who acts on a
 * statute should be told that where they are reading it, not only on the home
 * page.
 */
const DISCLAIMER =
  `<p class="meta disclaimer"><strong>Disclaimer:</strong> These statutes may not ` +
  `be the most recent version. The State of Hawaii may have more current or ` +
  `accurate information. No warranty or guarantee is made about the accuracy, ` +
  `completeness, or adequacy of the information on this site or of the ` +
  `information linked to on the state site. Please check ` +
  `<a href="https://www.capitol.hawaii.gov/hrscurrent/">the official Hawaii ` +
  `Revised Statutes</a>.</p>`;

/**
 * Render a PART/ARTICLE banner.
 *
 * The brackets come off for display and the fact is stated in words instead.
 * That matches how a bracketed *section* heading is already handled — the
 * parser strips the brackets and `isUncodified` carries the meaning — and it
 * stops `[PART IV. THE EXECUTIVE BUDGET]` from reading as a rendering artifact,
 * which is exactly how it read when the brackets were left in.
 *
 * Both forms occur: the whole banner bracketed, and only the designation
 * (`[PART VII.] ROUTINE REPAIR AND MAINTENANCE`).
 *
 * The note is real text in the document flow — not a tooltip, not an icon —
 * for the same reason the editorial note for a source anomaly is.
 */
export function partBanner(heading: string): string {
  const supplied = heading.includes("[");
  const label = heading.replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim();
  return (
    `<p class="part">${escapeHtml(label)}` +
    (supplied ? `<span class="supplied"> — supplied by the revisor</span>` : "") +
    `</p>`
  );
}

/**
 * The outline depth of each paragraph in a statute body.
 *
 * The HRS nests `(a)` -> `(1)` -> `(A)` -> `(i)`, and the enumerators are part
 * of the enacted text — so they stay visible verbatim and the structure is
 * carried by indentation rather than by real `<ol>` markup, which would either
 * duplicate the markers or replace them.
 *
 * Depth comes from the order each *kind* of marker first appears in the section,
 * not from a fixed table. Many sections start at `(1)` with no `(a)` above them;
 * a fixed table would indent those as though a level were missing.
 *
 * Two judgement calls, both documented rather than hidden:
 *
 * - **`(i)` is ambiguous** — the ninth letter and the first roman numeral. It is
 *   read as a letter when a lowercase level is already open and its last marker
 *   was `h`, which is the only decisive signal available; otherwise as a roman.
 * - **An unmarked paragraph keeps the current depth**, because most of them
 *   continue the item above. A trailing paragraph that belongs to the parent is
 *   therefore indented one level too far. Flattening them instead breaks far
 *   more paragraphs than it fixes.
 */
type MarkerKind = "digit" | "lower" | "upper" | "roman";

const PREDECESSOR: Record<string, string> = { i: "h", v: "u", x: "w" };

export function outline(paragraphs: string[]): { text: string; depth: number }[] {
  // One entry per open level, innermost last.
  const levels: { kind: MarkerKind; last: string }[] = [];
  const out: { text: string; depth: number }[] = [];

  for (const text of paragraphs) {
    const marker = text.match(/^\((\d{1,3}|[A-Za-z]{1,4})\)/)?.[1];
    if (!marker) {
      out.push({ text, depth: levels.length });
      continue;
    }

    let kind: MarkerKind;
    if (/^\d+$/.test(marker)) kind = "digit";
    else if (/^[A-Z]+$/.test(marker)) kind = marker.length > 1 ? "roman" : "upper";
    else if (marker.length > 1) kind = "roman";
    else if (marker in PREDECESSOR) {
      const open = levels.find((l) => l.kind === "lower");
      kind = open && open.last === PREDECESSOR[marker] ? "lower" : "roman";
    } else kind = "lower";

    const at = levels.findIndex((l) => l.kind === kind);
    if (at === -1) {
      levels.push({ kind, last: marker });
    } else {
      levels.length = at + 1;
      levels[at]!.last = marker;
    }
    out.push({ text, depth: levels.length });
  }

  return out;
}

/**
 * Split text on blank lines and linkify each paragraph.
 *
 * `outlined` turns on the indentation above. It is applied to statute bodies
 * only — annotation prose is editorial commentary and is not enumerated the
 * same way.
 */
const paragraphs = (
  text: string,
  index: Index,
  cls = "",
  annotation = false,
  outlined = false
): string => {
  const split = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rows = outlined
    ? outline(split)
    : split.map((p) => ({ text: p, depth: 0 }));

  return rows
    .map(({ text: p, depth }) => {
      const classes = [cls, depth ? `lv${Math.min(depth, 4)}` : ""].filter(Boolean).join(" ");
      return `<p${classes ? ` class="${classes}"` : ""}>${linkify(p, index, { annotation })}</p>`;
    })
    .join("\n");
};

/**
 * Annotation blocks, down-weighted for search.
 *
 * Case notes and commentary are far bulkier than the statute they sit under —
 * 5.3M characters against 32M, but concentrated on a minority of sections. At
 * equal weight a section's own text loses to the case law discussing it, which
 * is the wrong answer to "what does the statute say?".
 */
const annotationBlocks = (blocks: Annotation[], index: Index): string =>
  blocks
    .map(
      (note) =>
        `<h2>${escapeHtml(note.heading)}</h2>\n` +
        `<div data-pagefind-weight="0.4">${paragraphs(note.text, index, "ann", true)}</div>`
    )
    .join("\n");

/**
 * The editorial note for a source anomaly.
 *
 * The heading above it shows what the source says; this explains the difference
 * and names the number the section is published under. Real text in the document
 * flow, not a tooltip or an icon. See docs/source-anomalies.md.
 */
function anomalyNote(section: ParsedSection): string {
  return section.sourceAnomalies
    .map((a) => {
      const claim =
        a.confidence === "conclusive" && a.corrected
          ? `Published here as ${escapeHtml(a.corrected)}.`
          : `The correct value is not established, so the source's own is kept.`;
      return `<aside class="note"><strong>Editorial note</strong> — the source document gives
        ${escapeHtml(a.field === "sectionNumber" ? "this section's number" : a.field)} as
        ${escapeHtml(a.observed)}. ${escapeHtml(a.evidence)} ${claim}</aside>`;
    })
    .join("\n");
}

// --- pages ---

/**
 * The search page — the only page on the site that loads a script file.
 *
 * Everything else is pre-rendered precisely so there is nothing to fail; search
 * is the one thing a static file cannot do, so it is isolated here. Pagefind's
 * index is chunked, so a query pulls a few hundred KB rather than the corpus.
 *
 * Without JavaScript the page says so and hands the reader the navigation that
 * does work, rather than presenting a search box that silently does nothing.
 */
export function searchPage(): string {
  return page({
    title: "Search — Hawaii Revised Statutes",
    crumbs: [{ label: "HRS", href: "/" }, { label: "Search" }],
    head: `<link rel="stylesheet" href="/pagefind/pagefind-ui.css">\n`,
    body: `<h1>Search the statutes</h1>
<p class="meta">Searches the full text of every section and chapter, including
case notes and commentary. Annotations are weighted below the statutory text, so
a section's own words win over the case law discussing them. Type a section
number to go straight to it.</p>
<p id="jump" class="note" hidden></p>
<p id="spelling" class="note" hidden></p>
<div id="search"></div>
<noscript><p class="note"><strong>Search needs JavaScript</strong> — it is the
one thing on this site that does. Every statute page works without it: start
from <a href="/">the volume list</a>, or go straight to a section at
<code>/hrs/26-34</code>.</p></noscript>`,
    bodyEnd: `<script src="/pagefind/pagefind-ui.js"></script>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    new PagefindUI({
      element: "#search",
      showSubResults: true,
      showImages: false,
      pageSize: 20,
    });
    // Loaded after the UI exists, because it attaches to Pagefind's own input.
    var s = document.createElement("script");
    s.src = "/search.js";
    document.body.appendChild(s);
  });
</script>
`,
  });
}

export function sectionPage(
  section: ParsedSection,
  context: {
    chapterLabel: string;
    title?: TitleRef;
    prev?: ParsedSection;
    next?: ParsedSection;
    /** What cites this section, from the citation graph. */
    citedBy?: Edge[];
  },
  index: Index
): string {
  // Display text is the source's; identity is ours. Where a number was
  // corrected, the heading shows what the page actually says.
  const numberAnomaly = section.sourceAnomalies.find((a) => a.field === "sectionNumber");
  // The non-HRS documents are keyed by a synthesized identifier (`CONST §1-5`)
  // because it is stable and unique, but nobody cites them that way. The page
  // shows the citation a lawyer would write; the identifier stays the URL, so
  // nothing that already links here breaks.
  const shown = numberAnomaly
    ? numberAnomaly.observed
    : section.docType === "hrs"
      ? section.sectionNumber
      : properCitation(section);

  const body: string[] = [];
  // The title is linkified, not merely escaped: 29 titles in the corpus are
  // themselves citations ("Renumbered as §201H-205."), and on 23 of them it is
  // the only content the page has. Escaping it leaves the reader at a dead end
  // exactly where the pointer is the whole point.
  body.push(
    `<h1><span class="num">${escapeHtml(shown)}</span> ${linkify(section.title, index)}</h1>`
  );

  const flags: string[] = [];
  if (section.covers)
    flags.push(`covers ${escapeHtml(section.covers.start)} to ${escapeHtml(section.covers.end)}`);
  if (section.isRepealed) flags.push("repealed");
  // NOT "not yet codified", which this said until 2026-09-10 and which nothing
  // in the corpus supports. 7,859 sections (33.6%) have a bracketed heading —
  // far too many to be awaiting codification, and they are plainly printed in
  // the HRS. What the corpus does say, in its own Revision Notes, is that
  // brackets mark material the revisor supplied rather than the legislature
  // enacting it ("Bracketed words ... added by revisor"; "Part heading added by
  // revisor pursuant to §23G-15"), and that the legislature ratifies such
  // material by deleting the brackets. §23G-15(1) grants the revisor authority
  // to "number and renumber chapters, sections, and parts of sections", which
  // is what a bracketed heading records.
  //
  // Scoped to the heading on purpose: the statute's *text* is enacted law
  // either way, and a phrase like "not enacted" would invite exactly the wrong
  // reading. The field name `isUncodified` is still wrong and is tracked
  // separately — renaming it rewrites all 23,373 files.
  if (section.isUncodified) flags.push("heading supplied by the revisor");
  if (section.titleIsSupplied) flags.push("catchline supplied by the revisor");
  if (flags.length) body.push(`<p class="meta">${flags.join(" · ")}</p>`);

  if (section.sourceAnomalies.length) body.push(anomalyNote(section));
  if (section.partHeading) body.push(partBanner(section.partHeading));
  if (section.bodyText) body.push(paragraphs(section.bodyText, index, "", false, true));
  // Legislative history is NOT linkified. Measured over the whole corpus, its
  // 5,222 resolvable citations break down as 4,251 pointing at the section's own
  // page and 971 pointing at a different section — and every one of those 971 is
  // wrong. History cites the compilations this section used to live in, not
  // today's code: §502-13's history reads `RL 1955, §343-7`, which is its number
  // in the 1955 Revised Laws, and linking it lands the reader on today's
  // §343-7, "Limitation of actions". The same holds for `Supp, §121-16` and for
  // a pre-renumbering `HRS §88-64`.
  //
  // Not fixable in the detector: hazard 8's guard covers `R.L.H.` and `RLH` but
  // history writes the marker as bare `RL 1955`, and a former *HRS* number is
  // textually identical to a current one. Annotations are unaffected — they use
  // the punctuated form, and 0 of their links sit behind an uncovered marker.
  // So the block is the right unit of decision, and the yield of getting it
  // right would be zero useful links anyway. See docs/citation-linking.md.
  if (section.history) body.push(`<p class="history">${escapeHtml(section.history)}</p>`);
  if (section.annotations.length) body.push(annotationBlocks(section.annotations, index));
  // After the annotations: this is about the section, not part of it.
  body.push(citedBySection(context.citedBy, index));

  const link = (other: ParsedSection | undefined, rel: "prev" | "next") => {
    if (!other) return `<span></span>`;
    const arrow = rel === "prev" ? "← " : " →";
    const cited = other.docType === "hrs" ? other.sectionNumber : properCitation(other);
    const label = rel === "prev" ? `${arrow}${cited}` : `${cited}${arrow}`;
    return (
      `<a class="${rel}" rel="${rel}" href="${sectionHref(other.sectionNumber)}">` +
      `<span class="num">${escapeHtml(label)}</span><br>` +
      `<span class="meta">${escapeHtml(other.title)}</span></a>`
    );
  };

  return page({
    title: `${shown} ${section.title} — Hawaii Revised Statutes`,
    search: {
      meta: { number: shown, title: section.title, chapter: section.chapterNumber },
      // Facets a researcher actually narrows by. `status` is derived from what
      // the source states, never inferred: a section is "repealed" because its
      // heading says so.
      filters: {
        chapter: section.chapterNumber,
        document: section.docType,
        status: section.isRepealed ? "repealed" : "in force",
      },
    },
    crumbs: [
      ...topCrumbs(context.title),
      { label: context.chapterLabel, href: chapterHref(section.chapterNumber) },
      { label: shown },
    ],
    body: body.join("\n"),
    pager:
      context.prev || context.next
        ? `<nav class="pager wrap" aria-label="Section">${link(context.prev, "prev")}${link(
            context.next,
            "next"
          )}</nav>`
        : "",
    footer: sourceFooter(section.url, section.filename),
  });
}

export function chapterPage(
  chapterNumber: string,
  record: ChapterRecord | undefined,
  title: TitleRef | undefined,
  sections: ParsedSection[],
  index: Index,
  /** The chapter's index page on the source server. Two chapters have none. */
  source?: { url: string; filename: string },
  /** What cites this chapter, from the citation graph. */
  citedBy?: Edge[]
): string {
  const label = chapterLabel(chapterNumber, record);
  const body: string[] = [`<h1>${escapeHtml(label)}</h1>`];

  // Omitted at zero rather than printed as "0 sections": on those 293 chapters
  // the notes below say what actually happened, and a bare zero reads like a
  // build failure.
  const count = sections.length;
  if (count) body.push(`<p class="meta">${count === 1 ? "1 section" : `${count} sections`}</p>`);

  // For 293 chapters this is the only content there is: every section was
  // repealed, so no file in data/parsed carries the number and the listing
  // below is empty. Without it those pages would say nothing at all.
  if (record?.notes) body.push(paragraphs(record.notes, index, "note"));

  // Sections are grouped by the PART/ARTICLE banner they carry, which is how
  // the printed chapter is organised.
  //
  // `partHeading` marks where a part *begins* — it is null on every section
  // after the first one in that part (44 of chapter 26's 47). So the heading is
  // carried forward until the next one appears; treating a null as a change
  // instead starts a fresh, unlabelled list under every part's first section.
  let openPart: string | null = null;
  let listOpen = false;
  const rows: string[] = [];
  for (const section of sections) {
    if (section.partHeading && section.partHeading !== openPart) {
      if (listOpen) {
        rows.push(`</ol>`);
        listOpen = false;
      }
      openPart = section.partHeading;
      rows.push(partBanner(openPart));
    }
    if (!listOpen) {
      rows.push(`<ol class="toc">`);
      listOpen = true;
    }
    rows.push(
      `<li${section.isRepealed ? ' class="repealed"' : ""}>` +
        `<a href="${sectionHref(section.sectionNumber)}">` +
        `<span class="num">${escapeHtml(
          section.docType === "hrs" ? section.sectionNumber : properCitation(section)
        )}</span> ` +
        `<span class="t">${escapeHtml(section.title)}</span></a></li>`
    );
  }
  if (listOpen) rows.push(`</ol>`);
  body.push(rows.join("\n"));

  if (record?.annotations?.length) body.push(annotationBlocks(record.annotations, index));
  body.push(citedBySection(citedBy, index));

  return page({
    title: `${label} — Hawaii Revised Statutes`,
    search: {
      meta: { number: `Chapter ${chapterNumber}`, title: record?.title ?? "" },
      filters: { chapter: chapterNumber, document: "chapter index" },
    },
    crumbs: [...topCrumbs(title), { label: label }],
    body: body.join("\n"),
    footer: sourceFooter(source?.url, source?.filename ?? ""),
  });
}

export function chapterLabel(chapterNumber: string, record?: ChapterRecord): string {
  const nonHrs = NON_HRS_LABELS[chapterNumber];
  if (nonHrs) return nonHrs;
  const title = record?.title;
  return title ? `Chapter ${chapterNumber} — ${title}` : `Chapter ${chapterNumber}`;
}

/** A chapter's row in a listing: number, name, and how much is behind the link. */
export interface ChapterRow {
  number: string;
  /** The name to show. Volume pages use the chapter's own banner; title pages the TOC's. */
  name: string;
  sections: number;
}

const chapterRow = (c: ChapterRow): string => {
  const label = NON_HRS_LABELS[c.number];
  // 293 chapters have no section pages at all. Saying so here saves the
  // reader a click, and it is a plain fact about the corpus rather than a
  // claim about whether the chapter is in force — the chapter page itself
  // carries the source's own repeal note.
  const count =
    c.sections === 0 ? "no sections" : c.sections === 1 ? "1 section" : `${c.sections} sections`;
  return (
    `<li><a href="${chapterHref(c.number)}">` +
    // The non-HRS directories have no chapter number worth showing — their
    // name is the identifier.
    (label ? "" : `<span class="num">Chapter ${escapeHtml(c.number)}</span> `) +
    `<span class="t">${escapeHtml(label ?? c.name)}</span> ` +
    `<span class="meta">${count}</span></a></li>`
  );
};

export function volumePage(
  volume: number,
  range: string,
  chapters: ChapterRow[],
  source?: { url: string; dirName: string }
): string {
  return page({
    title: `Volume ${volume} — Hawaii Revised Statutes`,
    crumbs: [{ label: "HRS", href: "/" }, { label: `Volume ${volume}` }],
    body:
      `<h1>Volume ${volume}</h1>\n` +
      `<p class="meta">Chapters ${escapeHtml(range)} · ${chapters.length} chapters · ` +
      `how the printed edition is bound; the code itself is arranged by <a href="/">division and title</a></p>\n` +
      `<ul class="toc">${chapters.map(chapterRow).join("\n")}</ul>`,
    footer: sourceFooter(source?.url, source?.dirName ?? ""),
  });
}

/**
 * A title's page: its chapters as the printed table of contents lists them,
 * grouped by subtitle where the title has them (6 and 12), with the title's own
 * notes above and annotations below, as on a chapter page.
 *
 * Names come from the table of contents rather than the chapter banners — it
 * is what the source prints at this level, and it carries information the
 * banner does not (`--Repealed`).
 */
export function titlePage(
  title: TitleRecord,
  division: { number: number; name: string },
  sections: (chapterNumber: string) => number,
  index: Index,
  source?: { url: string; filename: string }
): string {
  const body: string[] = [];
  const supplied = title.supplied
    ? ` <span class="meta">(title supplied by the revisor)</span>`
    : "";
  body.push(`<h1>Title ${escapeHtml(title.number)} — ${escapeHtml(title.name)}${supplied}</h1>`);
  const count = title.listing.reduce((n, g) => n + g.chapters.length, 0);
  body.push(
    `<p class="meta">Division ${division.number}, ${escapeHtml(division.name)} · ` +
      `${count === 1 ? "1 chapter" : `${count} chapters`}</p>`
  );
  if (title.notes) body.push(paragraphs(title.notes, index, "note"));

  for (const group of title.listing) {
    if (group.subtitle) body.push(`<h2>${escapeHtml(group.subtitle)}</h2>`);
    const rows = group.chapters.map((c) =>
      chapterRow({ number: c.number, name: c.name, sections: sections(c.number) })
    );
    body.push(`<ul class="toc">${rows.join("\n")}</ul>`);
  }
  // Placed by number, not by the source: say so, in the document flow like
  // every other editorial note.
  if (title.unlisted?.length) {
    const list = title.unlisted.map((n) => `chapter ${escapeHtml(n)}`).join(", ");
    body.push(
      `<p class="note">The published table of contents for this title does not list ` +
        `${list}; ${title.unlisted.length === 1 ? "it is" : "they are"} placed above by number.</p>`
    );
  }
  if (title.annotations.length) body.push(annotationBlocks(title.annotations, index));

  return page({
    title: `Title ${title.number} — ${title.name} — Hawaii Revised Statutes`,
    crumbs: [{ label: "HRS", href: "/" }, { label: `Title ${title.number}` }],
    body: body.join("\n"),
    footer: sourceFooter(source?.url, source?.filename ?? ""),
  });
}

export function homePage(
  divisions: {
    number: number;
    name: string;
    titles: { number: string; name: string; chapters: number }[];
  }[],
  volumes: { number: number; range: string }[],
  stats: { sections: number; chapters: number },
  sourceUrl?: string
): string {
  const rows = divisions
    .map(
      (d) =>
        `<h2>Division ${d.number} — ${escapeHtml(d.name)}</h2>\n<ul class="toc">` +
        d.titles
          .map(
            (t) =>
              `<li><a href="${titleHref(t.number)}">` +
              `<span class="num">Title ${escapeHtml(t.number)}</span> ` +
              `<span class="t">${escapeHtml(t.name)}</span> ` +
              `<span class="meta">${t.chapters === 1 ? "1 chapter" : `${t.chapters} chapters`}</span></a></li>`
          )
          .join("\n") +
        `</ul>`
    )
    .join("\n");
  // The printed edition's arrangement. Still occasionally what someone has in
  // hand, and the pages already exist; one line keeps them reachable.
  const printed = volumes
    .map((v) => `<a href="${volumeHref(v.number)}">${v.number}</a>`)
    .join(", ");

  return page({
    title: "Hawaii Revised Statutes",
    crumbs: [{ label: "Hawaii Revised Statutes" }],
    body:
      `<h1>Hawaii Revised Statutes</h1>
<p>The full text of the Hawaii Revised Statutes, with every reference to another
statute resolved into a link. ${stats.sections.toLocaleString()} sections across
${stats.chapters.toLocaleString()} chapters.</p>
<p class="meta">Unofficial. The statutes as published by the Hawaii State
Legislature are the authority; this is a readable, cross-linked copy of them. A
citation is linked only when the section it names exists in the corpus — what
does not resolve is left as plain text rather than guessed at.</p>
${rows}
<p class="meta">The printed edition binds these into volumes ${printed}.</p>`,
    footer: sourceFooter(sourceUrl, "capitol.hawaii.gov/hrscurrent"),
  });
}


/**
 * Served by the host for any address that is not a page (`ErrorDocument 404`
 * in `.htaccess`), and by `bun run serve` locally. The common way to land here
 * is a mistyped or renumbered section, so it offers the address form rather
 * than just the top of the site.
 */
export function notFoundPage(): string {
  return page({
    title: "Not found — Hawaii Revised Statutes",
    crumbs: [{ label: "HRS", href: "/" }, { label: "Not found" }],
    body: `<h1>No page at that address</h1>
<p>Section pages live at <code>/hrs/</code> followed by the section number
&mdash; <a href="/hrs/26-34"><code>/hrs/26-34</code></a> for §26-34,
<a href="/hrs/431-1-100"><code>/hrs/431-1-100</code></a> for §431:1-100.
Chapters are at <code>/hrs/chapter/26</code> and titles at <code>/hrs/title/4</code>.</p>
<p>A section that was repealed or renumbered has no page of its own. Its
chapter page lists what the chapter holds now, and
<a href="/search">search</a> covers the full text.</p>
<p><a href="/">Start from the volume list</a>.</p>`,
  });
}
