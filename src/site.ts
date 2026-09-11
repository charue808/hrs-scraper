/**
 * The site's markup.
 *
 * Split from the build driver so the rules that matter — what gets linked, what
 * deliberately does not, and how the structure is grouped — can be tested
 * without running a 24,500-file build. `build.ts` owns reading the corpus and
 * writing files; this file owns what a page looks like.
 *
 * Pages are rendered from the structured fields, never from `bodyHtml`. No
 * JavaScript is emitted.
 */
import {
  type Annotation,
  type ChapterRecord,
  type ParsedSection,
} from "./config";
import { escapeHtml, linkify } from "./citations";
import { chapterHref, sectionHref, volumeHref, type Index } from "./resolver";

/**
 * The six non-HRS directories, which are numbered as prefixed identifiers
 * rather than proper citations. Labelled here so navigation reads correctly;
 * giving them real citations is tracked as the last correctness gap in
 * `docs/STATE.md`.
 */
export const NON_HRS_LABELS: Record<string, string> = {
  "01-USCON": "United States Constitution",
  "02-HNP": "Hawaii National Park",
  "03-ORG": "Organic Act",
  "04-ADM": "Admission Act",
  "05-CONST": "Hawaii State Constitution",
  "06-HHCA": "Hawaiian Homes Commission Act",
};

// --- markup ---

export const STYLE = `
:root { --ink:#1a1a1a; --muted:#5a5a5a; --rule:#d8d4cc; --bg:#fbfaf7;
        --note-bg:#fdf6e3; --note-edge:#b58900; --accent:#7a5c00; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#e8e6e1; --muted:#a6a29a; --rule:#3a3733; --bg:#16150f;
          --note-bg:#241f14; --note-edge:#b58900; --accent:#d9b74a; }
}
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
nav.crumbs { border-bottom:1px solid var(--rule); font-size:.82rem;
             font-family: system-ui, sans-serif; }
nav.crumbs ol { list-style:none; display:flex; flex-wrap:wrap; gap:.5rem;
                padding:.75rem 0; margin:0; color: var(--muted); }
nav.crumbs li + li::before { content:"› "; color: var(--rule); }
nav.pager { border-top:1px solid var(--rule); display:flex; gap:1rem;
            justify-content:space-between; padding:1rem 0; font-size:.9rem; }
nav.pager a { flex:1 1 0; text-decoration:none; }
nav.pager .next { text-align:right; }
footer { border-top:1px solid var(--rule); padding:1rem 0 2rem; }
@media (max-width: 30rem) { nav.pager { flex-direction: column; }
                            nav.pager .next { text-align:left; } }
`;

interface Crumb {
  label: string;
  href?: string;
}

export function page(opts: {
  title: string;
  crumbs: Crumb[];
  body: string;
  pager?: string;
  footer?: string;
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
<link rel="stylesheet" href="/style.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<nav class="crumbs" aria-label="Breadcrumb"><div class="wrap"><ol>${crumbs}</ol></div></nav>
<main id="content" class="wrap">
${opts.body}
</main>
${opts.pager ?? ""}
${opts.footer ?? ""}
</body>
</html>
`;
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

const annotationBlocks = (blocks: Annotation[], index: Index): string =>
  blocks
    .map(
      (note) =>
        `<h2>${escapeHtml(note.heading)}</h2>\n${paragraphs(note.text, index, "ann", true)}`
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

export function sectionPage(
  section: ParsedSection,
  context: { chapterLabel: string; volume: number; prev?: ParsedSection; next?: ParsedSection },
  index: Index
): string {
  // Display text is the source's; identity is ours. Where a number was
  // corrected, the heading shows what the page actually says.
  const numberAnomaly = section.sourceAnomalies.find((a) => a.field === "sectionNumber");
  const shown = numberAnomaly ? numberAnomaly.observed : section.sectionNumber;

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
  if (section.partHeading) body.push(`<p class="part">${escapeHtml(section.partHeading)}</p>`);
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

  const link = (other: ParsedSection | undefined, rel: "prev" | "next") => {
    if (!other) return `<span></span>`;
    const arrow = rel === "prev" ? "← " : " →";
    const label = rel === "prev" ? `${arrow}${other.sectionNumber}` : `${other.sectionNumber}${arrow}`;
    return (
      `<a class="${rel}" rel="${rel}" href="${sectionHref(other.sectionNumber)}">` +
      `<span class="num">${escapeHtml(label)}</span><br>` +
      `<span class="meta">${escapeHtml(other.title)}</span></a>`
    );
  };

  return page({
    title: `${shown} ${section.title} — Hawaii Revised Statutes`,
    crumbs: [
      { label: "HRS", href: "/" },
      { label: `Volume ${context.volume}`, href: volumeHref(context.volume) },
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
    footer:
      `<footer class="wrap"><p class="meta">Source: ` +
      `<a href="${escapeHtml(section.url)}">${escapeHtml(section.filename)}</a></p></footer>`,
  });
}

export function chapterPage(
  chapterNumber: string,
  record: ChapterRecord | undefined,
  volume: number,
  sections: ParsedSection[],
  index: Index
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
      rows.push(`<p class="part">${escapeHtml(openPart)}</p>`);
    }
    if (!listOpen) {
      rows.push(`<ol class="toc">`);
      listOpen = true;
    }
    rows.push(
      `<li${section.isRepealed ? ' class="repealed"' : ""}>` +
        `<a href="${sectionHref(section.sectionNumber)}">` +
        `<span class="num">${escapeHtml(section.sectionNumber)}</span> ` +
        `<span class="t">${escapeHtml(section.title)}</span></a></li>`
    );
  }
  if (listOpen) rows.push(`</ol>`);
  body.push(rows.join("\n"));

  if (record?.annotations?.length) body.push(annotationBlocks(record.annotations, index));

  return page({
    title: `${label} — Hawaii Revised Statutes`,
    crumbs: [
      { label: "HRS", href: "/" },
      { label: `Volume ${volume}`, href: volumeHref(volume) },
      { label: label },
    ],
    body: body.join("\n"),
  });
}

export function chapterLabel(chapterNumber: string, record?: ChapterRecord): string {
  const nonHrs = NON_HRS_LABELS[chapterNumber];
  if (nonHrs) return nonHrs;
  const title = record?.title;
  return title ? `Chapter ${chapterNumber} — ${title}` : `Chapter ${chapterNumber}`;
}

export function volumePage(
  volume: number,
  range: string,
  chapters: { number: string; record?: ChapterRecord; sections: number }[]
): string {
  const rows = chapters
    .map((c) => {
      const label = NON_HRS_LABELS[c.number];
      // 293 chapters have no section pages at all. Saying so here saves the
      // reader a click, and it is a plain fact about the corpus rather than a
      // claim about whether the chapter is in force — the chapter page itself
      // carries the source's own repeal note.
      const count =
        c.sections === 0
          ? "no sections"
          : c.sections === 1
            ? "1 section"
            : `${c.sections} sections`;
      return (
        `<li><a href="${chapterHref(c.number)}">` +
        // The non-HRS directories have no chapter number worth showing — their
        // name is the identifier.
        (label ? "" : `<span class="num">Chapter ${escapeHtml(c.number)}</span> `) +
        `<span class="t">${escapeHtml(label ?? c.record?.title ?? "")}</span> ` +
        `<span class="meta">${count}</span></a></li>`
      );
    })
    .join("\n");

  return page({
    title: `Volume ${volume} — Hawaii Revised Statutes`,
    crumbs: [{ label: "HRS", href: "/" }, { label: `Volume ${volume}` }],
    body:
      `<h1>Volume ${volume}</h1>\n` +
      `<p class="meta">Chapters ${escapeHtml(range)} · ${chapters.length} chapters</p>\n` +
      `<ul class="toc">${rows}</ul>`,
  });
}

export function homePage(
  volumes: { number: number; range: string; chapters: number }[],
  stats: { sections: number; chapters: number }
): string {
  const rows = volumes
    .map(
      (v) =>
        `<li><a href="${volumeHref(v.number)}">` +
        `<span class="num">Volume ${v.number}</span> ` +
        `<span class="t">Chapters ${escapeHtml(v.range)} · ${v.chapters} chapters</span></a></li>`
    )
    .join("\n");

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
<h2>Volumes</h2>
<ul class="toc">${rows}</ul>`,
  });
}

