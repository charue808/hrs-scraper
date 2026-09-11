/**
 * The citation graph.
 *
 * `detect()` already resolves every citation against the real inventory; this
 * collects those resolutions into a graph so the reverse question — *what cites
 * this section?* — becomes answerable. That question is the one a researcher
 * actually asks and the published statutes cannot answer at all.
 *
 * Three rules decide what becomes an edge:
 *
 * - **Legislative history is excluded.** Its section numbers name former
 *   compilations, not today's code; 971 of them point at an unrelated section.
 *   See `docs/citation-linking.md`, hazard 9.
 * - **Self-citations are dropped.** A section naming its own number adds no
 *   edge and would put every section in its own backlink list.
 * - **Ranges contribute their implied members.** `sections 11-1 to 11-9` means
 *   the whole span, so a section cited only inside a range would otherwise look
 *   uncited. Those edges are labelled `range` so they can be told apart from
 *   ones with text a reader can click.
 */
import { detect, expandRange, type Citation } from "./citations";
import type { Index } from "./resolver";
import type { ParsedSection } from "./config";

/** Which part of the citing document the reference sits in. */
export type Block = "body" | "annotation" | "range";

export interface Edge {
  from: string;
  to: string;
  kind: "section" | "chapter";
  block: Block;
}

export interface Graph {
  /** Outbound: section number -> what it cites. */
  cites: Map<string, Edge[]>;
  /** Inbound: section or chapter number -> what cites it. */
  citedBy: Map<string, Edge[]>;
}

/**
 * Build the graph over the whole corpus.
 *
 * Edges are deduplicated on `from|to|block`: a section that names §26-34 six
 * times is one edge, not six. A body reference and an annotation reference to
 * the same target are kept separately, because they mean different things — one
 * is the statute pointing somewhere, the other is commentary about it.
 */
export function buildGraph(corpus: ParsedSection[], index: Index): Graph {
  const cites = new Map<string, Edge[]>();
  const citedBy = new Map<string, Edge[]>();
  const seen = new Set<string>();

  const add = (from: string, to: string, kind: "section" | "chapter", block: Block) => {
    if (to === from) return; // self-citation
    const key = `${from}|${to}|${block}`;
    if (seen.has(key)) return;
    seen.add(key);
    const edge: Edge = { from, to, kind, block };
    (cites.get(from) ?? cites.set(from, []).get(from)!).push(edge);
    (citedBy.get(to) ?? citedBy.set(to, []).get(to)!).push(edge);
  };

  const collect = (from: string, text: string, block: "body" | "annotation") => {
    if (!text) return;
    const found: Citation[] = detect(text, index, { annotation: block === "annotation" });
    for (const citation of found) {
      if (citation.target) add(from, citation.target.number, citation.kind, block);
    }
    for (const target of expandRange(found, index)) add(from, target.number, "section", "range");
  };

  for (const section of corpus) {
    const from = section.sectionNumber;
    collect(from, section.bodyText, "body");
    for (const note of section.annotations) collect(from, note.text, "annotation");
    // history is deliberately not collected — hazard 9
  }

  return { cites, citedBy };
}

/**
 * The graph as a JSON-serializable adjacency map, sorted for stability.
 *
 * Shaped for a reader of the file rather than for the renderer: everything about
 * one section sits under that section's key, so answering "what cites §26-34?"
 * needs no inversion pass. Only `to` and `block` are stored per edge — `from` is
 * the key it lives under.
 */
export function serializeGraph(graph: Graph): string {
  const numbers = new Set([...graph.cites.keys(), ...graph.citedBy.keys()]);
  const sortKey = (n: string) =>
    (n.match(/\d+|[A-Za-z]+/g) ?? []).map((p) => (/\d/.test(p) ? p.padStart(8, "0") : p)).join("");

  const entry = (edges: Edge[] | undefined, field: "from" | "to") =>
    (edges ?? [])
      .map((e) => ({ [field === "to" ? "to" : "from"]: e[field], kind: e.kind, block: e.block }))
      .sort((a, b) =>
        sortKey(String(a[field === "to" ? "to" : "from"])).localeCompare(
          sortKey(String(b[field === "to" ? "to" : "from"]))
        )
      );

  const out: Record<string, unknown> = {};
  for (const number of [...numbers].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
    const cites = entry(graph.cites.get(number), "to");
    const citedBy = entry(graph.citedBy.get(number), "from");
    out[number] = {
      ...(cites.length ? { cites } : {}),
      ...(citedBy.length ? { citedBy } : {}),
    };
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}
