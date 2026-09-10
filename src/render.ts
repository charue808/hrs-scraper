/**
 * Render a chapter to static HTML, with citations resolved to links.
 *
 * Deliberately minimal — this exists so citation linking can be reviewed by eye
 * rather than only by counts. The markup follows the rules the real build will
 * need: no JavaScript, semantic structure, link text that is the citation
 * itself, and unresolved citations left as plain text.
 *
 *   bun run render -- --chapter 26
 *   bun run render -- --chapter 6E --out build/preview
 */
import { parseArgs } from "node:util";
import { readdirSync } from "node:fs";
import { PARSED_DIR, type ParsedSection } from "./config";
import { escapeHtml, linkify } from "./citations";
import { buildIndex, sectionSlug, type Index } from "./resolver";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { chapter: { type: "string" }, out: { type: "string" } },
  allowPositionals: true,
});

const chapterNumber = values.chapter;
const outDir = values.out ?? "build/preview";
if (!chapterNumber) {
  console.error("usage: bun run render -- --chapter <number> [--out <dir>]");
  process.exit(1);
}

const STYLE = `
  :root { --ink:#1a1a1a; --muted:#5a5a5a; --rule:#d8d4cc; --bg:#fbfaf7; --link:#0b5;
          --note-bg:#fdf6e3; --note-edge:#b58900; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e8e6e1; --muted:#a6a29a; --rule:#3a3733; --bg:#16150f;
            --note-bg:#241f14; --note-edge:#b58900; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.65 Georgia, 'Times New Roman', serif; }
  main, header { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1rem; }
  h1 { font-size: 1.4rem; line-height:1.3; margin:0 0 .25rem; }
  h2 { font-size: 1rem; text-transform: uppercase; letter-spacing:.06em; margin:2rem 0 .5rem;
       color: var(--muted); font-family: system-ui, sans-serif; }
  .num { font-family: system-ui, sans-serif; font-weight:700; }
  a { color: inherit; text-decoration: underline; text-underline-offset: 2px;
      text-decoration-color: var(--note-edge); text-decoration-thickness: 2px; }
  a:hover, a:focus { background: var(--note-bg); }
  .meta { color: var(--muted); font-size:.85rem; font-family: system-ui, sans-serif; }
  .history { color: var(--muted); font-size:.9rem; }
  .note { background: var(--note-bg); border-left: 4px solid var(--note-edge);
          padding:.75rem 1rem; margin:1rem 0; font-size:.92rem; }
  .note strong { font-family: system-ui, sans-serif; }
  .ann { font-size:.94rem; }
  ul.toc { list-style:none; padding:0; }
  ul.toc li { border-bottom:1px solid var(--rule); padding:.5rem 0; }
  .repealed { color: var(--muted); }
  /* A citation into the HRS whose section is no longer in the code. Marked, not
     linked: a dotted underline is the non-color affordance (WCAG 1.4.1), and the
     clarification is real text for assistive technology. */
  .absent { border-bottom: 1px dotted var(--muted); }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
             overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
  nav { border-bottom:1px solid var(--rule); }
`;

const page = (title: string, body: string): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<nav><header class="meta"><a href="./index.html">Chapter ${escapeHtml(chapterNumber!)}</a></header></nav>
${body}
</body>
</html>
`;

/**
 * The preview writes flat files, so the site-absolute hrefs the renderer emits
 * are rewritten to point at neighbouring files. Only the preview does this; the
 * real build keeps the canonical paths.
 */
const localize = (html: string): string =>
  html
    .replace(/href="\/hrs\/chapter\/([^"]+)"/g, (_, n) =>
      n === chapterNumber ? 'href="./index.html"' : `href="./chapter-${n}.html"`
    )
    .replace(/href="\/hrs\/([^"]+)"/g, 'href="./$1.html"');

const paragraphs = (text: string, index: Index, cls = ""): string =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${cls ? ` class="${cls}"` : ""}>${localize(linkify(p, index))}</p>`)
    .join("\n");

/**
 * The editorial note for a source anomaly.
 *
 * The heading above it shows what the source says; this explains the difference
 * and names the number the section is published under. Real text in the document
 * flow, not a tooltip or an icon. See docs/source-anomalies.md.
 */
function anomalyNote(section: ParsedSection): string {
  if (!section.sourceAnomalies.length) return "";
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

function renderSection(section: ParsedSection, index: Index): string {
  // Display text is the source's; identity is ours. Where a number was
  // corrected, the heading shows what the page actually says.
  const numberAnomaly = section.sourceAnomalies.find((a) => a.field === "sectionNumber");
  const shown = numberAnomaly ? numberAnomaly.observed : section.sectionNumber;

  const parts = [
    `<main>`,
    `<h1><span class="num">${escapeHtml(shown)}</span> ${escapeHtml(section.title)}</h1>`,
  ];

  const flags: string[] = [];
  if (section.covers) flags.push(`covers ${escapeHtml(section.covers.start)} to ${escapeHtml(section.covers.end)}`);
  if (section.isRepealed) flags.push("repealed");
  if (section.isUncodified) flags.push("not yet codified");
  if (section.titleIsSupplied) flags.push("title supplied editorially");
  if (flags.length) parts.push(`<p class="meta">${flags.join(" · ")}</p>`);

  parts.push(anomalyNote(section));
  if (section.partHeading) parts.push(`<p class="meta">${escapeHtml(section.partHeading)}</p>`);
  if (section.bodyText) parts.push(paragraphs(section.bodyText, index));
  if (section.history) parts.push(`<p class="history">${localize(linkify(section.history, index))}</p>`);

  for (const note of section.annotations) {
    parts.push(`<h2>${escapeHtml(note.heading)}</h2>`);
    parts.push(paragraphs(note.text, index, "ann"));
  }

  parts.push(`<p class="meta">Source: <a href="${escapeHtml(section.url)}">${escapeHtml(section.filename)}</a></p>`);
  parts.push(`</main>`);
  return page(`${shown} ${section.title}`, parts.join("\n"));
}

// --- collect the chapter ---
const wanted: ParsedSection[] = [];
for (const file of readdirSync(PARSED_DIR)) {
  const section: ParsedSection = await Bun.file(`${PARSED_DIR}/${file}`).json();
  if (section.chapterNumber === chapterNumber) wanted.push(section);
}
if (!wanted.length) {
  console.error(`no sections found for chapter ${chapterNumber}`);
  process.exit(1);
}

// Sort by the numeric parts of the section number so 26-9 precedes 26-10.
const sortKey = (n: string) =>
  (n.match(/\d+|[A-Za-z]+/g) ?? []).map((p) => (/\d/.test(p) ? p.padStart(8, "0") : p)).join("");
wanted.sort((a, b) => sortKey(a.sectionNumber).localeCompare(sortKey(b.sectionNumber)));

const index = await buildIndex();

for (const section of wanted) {
  await Bun.write(`${outDir}/${sectionSlug(section.sectionNumber)}.html`, renderSection(section, index));
}

const toc = wanted
  .map(
    (s) =>
      `<li><a href="./${sectionSlug(s.sectionNumber)}.html"><span class="num">${escapeHtml(
        s.sectionNumber
      )}</span></a> <span${s.isRepealed ? ' class="repealed"' : ""}>${escapeHtml(s.title)}</span></li>`
  )
  .join("\n");

await Bun.write(
  `${outDir}/index.html`,
  page(
    `HRS chapter ${chapterNumber}`,
    `<main><h1>Chapter ${escapeHtml(chapterNumber)}</h1>
     <p class="meta">${wanted.length} sections</p>
     <ul class="toc">${toc}</ul></main>`
  )
);

console.log(`${wanted.length} sections -> ${outDir}/`);
