/**
 * Run the citation detector over the corpus and report the quality metric.
 *
 * The unresolved count is the number to watch run over run: it is where the
 * grammar is still wrong. Rejections are reported by reason rather than as one
 * total, because "bare number" and "unresolved" mean very different things —
 * the first is the detector working, the second is the detector's to-do list.
 *
 *   bun run profile-citations
 *   bun run profile-citations -- --show 40   # more unresolved detail
 */
import { parseArgs } from "node:util";
import { readdirSync } from "node:fs";
import { PARSED_DIR, type ParsedSection } from "./config";
import { detect, expandRange, tally, type Citation } from "./citations";
import { buildIndex } from "./resolver";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { show: { type: "string" } },
  allowPositionals: true,
});
const show = values.show ? parseInt(values.show, 10) : 20;

const index = await buildIndex();
console.log(
  `index: ${index.sections.size} sections, ${index.chapters.size} chapters, ${index.aliases.size} alias(es)\n`
);

type Bucket = { name: string; citations: Citation[] };
const body: Citation[] = [];
const xrefs: Citation[] = [];
const annotations = new Map<string, Citation[]>();
const unresolved = new Map<string, { n: number; sample: string }>();
let rangeEdges = 0;

const noteBucket = (heading: string): string =>
  /^case notes?$/i.test(heading) ? "Case Notes"
  : /^cross references?$/i.test(heading) ? "Cross References"
  : /^attorney general/i.test(heading) ? "Attorney General Opinions"
  : /^law journals/i.test(heading) ? "Law Journals and Reviews"
  : /commentary/i.test(heading) ? "Commentary"
  : "other";

for (const file of readdirSync(PARSED_DIR)) {
  const section: ParsedSection = await Bun.file(`${PARSED_DIR}/${file}`).json();

  const record = (text: string, into: Citation[], annotation: boolean) => {
    const found = detect(text, index, { annotation });
    rangeEdges += expandRange(found, index).length;
    for (const citation of found) {
      into.push(citation);
      if (citation.reason !== "unresolved") continue;
      const hit = unresolved.get(citation.number);
      if (hit) hit.n++;
      else {
        const from = Math.max(0, citation.start - 40);
        unresolved.set(citation.number, {
          n: 1,
          sample: text.slice(from, citation.end + 40).replace(/\s+/g, " "),
        });
      }
    }
  };

  record(section.bodyText, body, false);
  for (const entry of section.crossReferences) record(entry, xrefs, true);
  for (const note of section.annotations) {
    const key = noteBucket(note.heading);
    const into = annotations.get(key) ?? annotations.set(key, []).get(key)!;
    record(note.text, into, true);
  }
}

function report({ name, citations }: Bucket): void {
  const counts = tally(citations);
  const total = citations.length;
  if (!total) return;
  const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;
  const linked = counts.linked ?? 0;
  const rejects = Object.entries(counts)
    .filter(([k]) => k !== "linked")
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n.toLocaleString()}`)
    .join(", ");
  console.log(
    `${name.padEnd(26)} ${total.toLocaleString().padStart(7)} candidates  ` +
      `linked ${linked.toLocaleString().padStart(7)} (${pct(linked).padStart(6)})  ` +
      `unresolved ${(counts.unresolved ?? 0).toLocaleString().padStart(5)} (${pct(counts.unresolved ?? 0)})`
  );
  console.log(`${" ".repeat(28)}rejected: ${rejects}`);
}

console.log("=== body text ===");
report({ name: "bodyText", citations: body });

console.log("\n=== annotations ===");
report({ name: "crossReferences (field)", citations: xrefs });
for (const [name, citations] of [...annotations].sort((a, b) => b[1].length - a[1].length)) {
  report({ name, citations });
}

console.log(
  `\ngraph edges implied by ranges beyond their endpoints: ${rangeEdges.toLocaleString()}`
);

const totalUnresolved = [...unresolved.values()].reduce((sum, u) => sum + u.n, 0);
console.log(
  `\n=== unresolved: ${totalUnresolved.toLocaleString()} occurrences, ${unresolved.size} distinct ===`
);
for (const [number, { n, sample }] of [...unresolved].sort((a, b) => b[1].n - a[1].n).slice(0, show)) {
  console.log(`  ${String(n).padStart(4)}  ${number.padEnd(14)} ...${sample}...`);
}
