# Source Anomalies & Editorial Corrections

**Last updated**: 2026-09-09
**Status**: implemented — `src/corrections.ts`, `data/corrections.json`

The published HRS contains errors. This document defines how we record them,
how we decide to act on one, and how the rendered site presents them.

The governing rule: **we publish the statute as it is published, and we say so
when it is wrong.** We do not silently repair the government's text.

---

## The problem, concretely

`HRS_0634G-0002.htm` — the file sits in the `HRS0634G/` directory, but its own
heading reads `§643G-2`. The digits are transposed.

The evidence that this is an error and not a real section is conclusive:

| | |
|---|---|
| Chapter `643G` | does not exist — the manifest has no `HRS0643G/` directory |
| Chapter `634G` | exists, 13 files |
| `§634G-1`, `§634G-3`, `§634G-4` | all read `634G`, all from `[L 2022, c 96, pt of §2]` |
| `§643G-2` | same act, same chapter, one heading out of step |

Left alone, this produces a section filed under a chapter that does not exist,
unreachable from its own chapter index, and a phantom `§643G-2` in the citation
resolver's index that nothing will ever legitimately point at.

---

## The principle: identity is ours, text is theirs

Two jobs that must not be conflated:

- **Identity** — the number the section is *filed under*. Drives the URL, the
  chapter grouping, the resolver index, the sort order of the chapter listing.
  This is our construction, and it must be correct or navigation breaks.
- **Display text** — what the page *shows*. This is the source's, and it stays
  the source's.

So `HRS_0634G-0002.htm` is filed as `§634G-2`, and its page heading reads
`§643G-2`, with an editorial note explaining the difference.

### One URL, not two

**Decided 2026-09-09.** The section is served at exactly one address, under the
corrected identity. No alias route, no redirect from the erroneous number.

A redirect would mean publishing a URL that asserts `§643G-2` is a thing that
exists. It isn't. The editorial note is the bridge for a reader who arrives
looking for the number as printed — see Search below, which is what actually
makes that reader's search succeed.

### Not brackets

The conventional editorial marker — `[sic]`, or the correction in brackets — is
unavailable here. This corpus already uses `[...]` for three distinct things:

| Form | Existing meaning |
|---|---|
| `[§11-1.52]` | heading supplied by the revisor (`isUncodified` — misnamed) |
| `[OLD]` | superseded part banner |
| `[L 2022, c 96, pt of §2]` | legislative history |

A fourth bracket meaning would be unreadable. Editorial content gets its own
channel: a distinct, labelled note block, never a bracket inside statute text.

---

## Corrections are reviewed data, not detection

A correction asserts that the State of Hawaii published an error. That is an
editorial claim and it gets a human in the loop. It is **not** something the
parser infers at runtime — the parser does not even hold the manifest, so it
cannot check whether a chapter exists.

Corrections live in a small, reviewed, diffable file: **`data/corrections.json`**,
applied by **`src/corrections.ts`** after parsing. `parser.ts` stays a faithful
reporter of what the page says; the ledger is layered on top of it.

```json
{
  "version": 1,
  "corrections": [
    {
      "filename": "HRS_0634G-0002.htm",
      "field": "sectionNumber",
      "observed": "§643G-2",
      "corrected": "§634G-2",
      "confidence": "conclusive",
      "evidence": "Chapter 643G does not exist in the corpus. §634G-1, §634G-3 and §634G-4 are in the same chapter directory and carry the same history line [L 2022, c 96, pt of §2].",
      "reviewedOn": "2026-09-09"
    }
  ]
}
```

The pipeline applies the file and stamps what it did onto the section, so the
rendered note is **generated from the record** rather than hand-written into
prose. One source of truth; the site cannot drift from the ledger.

`loadCorrections()` validates strictly and throws — a malformed ledger must fail
loudly rather than silently mis-correct a statute. It rejects an unknown
confidence tier, a conclusive entry with nothing to correct to, a flagged entry
that smuggles in a correction, a field outside the correctable set, a missing
evidence line, and two entries for the same file and field.

**A correction whose `observed` value no longer appears in the source is not
applied.** It warns instead and leaves the section alone: either the parser
changed or the State fixed the error upstream, and both need a human to look
rather than a silent overwrite. This is the mechanism open question 3 asks for.

### This file is not a bug tracker

The guardrail that keeps it honest: `corrections.json` records errors **in the
source document**. It never records errors in our parser.

The four defects found in the 2026-09-09 scrape QA illustrate the line:

| Finding | Where it belongs |
|---|---|
| `§643G-2` transposed digits | `corrections.json` — the source is wrong |
| Range-repeal headings picking up `[OLD]` part numbers | parser fix |
| `filenameToSectionNumber` not uppercasing chapter letters | parser fix |
| Stray `[` / `]` in 145 titles | parser fix |

If a correction entry would paper over a parser bug, fix the parser. A growing
corrections file is a signal to inspect, not a sign of thoroughness.

### Confidence tiers

Two, and they behave differently:

- **`conclusive`** — the correct value is established by evidence internal to
  the corpus, as with `§643G-2` above. The section is filed under the corrected
  identity, and the note states the correction.
- **`flagged`** — something is wrong but the right answer is not established.
  **Nothing is corrected.** The section keeps the source's value as its
  identity, and the note describes the discrepancy without asserting a fix.

There is no third tier for "probably." If we cannot show the answer, we flag it.

---

## Data model

`ParsedSection` gains one field:

```ts
interface SourceAnomaly {
  field: string;           // e.g. "sectionNumber"
  observed: string;        // what the source document says
  corrected: string | null; // null when confidence is "flagged"
  confidence: "conclusive" | "flagged";
  evidence: string;
}

sourceAnomalies: SourceAnomaly[];   // [] on the overwhelming majority
```

Added to `SECTION_FIELD_ORDER` so serialization stays byte-stable.
`numberSource` gains a `correction` value, so a section whose number came from
the ledger does not claim to have read it off the page.

**Do this before the baseline corpus commit.** Adding an always-present field to
23,373 files is a one-time rewrite of every file; done now, while the corpus is
uncommitted, it costs nothing and no diff ever records it. Done later it churns
the entire corpus for no semantic reason and buries the first real amendment
diff. This is the same reasoning that made `serializeSection()` blocking.

The field is always present, empty array included, so consumers never need a
`?? []` guard.

---

## Rendering

### The note

Generated from the record, placed immediately after the heading, in the document
flow:

> **§643G-2** Scope of chapter.
>
> *Editorial note — the source document numbers this section §643G-2. Chapter
> 643G does not exist; §634G-1, §634G-3 and §634G-4 are from the same act
> (L 2022, c 96). Published here as §634G-2.*

The heading is the source's text. The note carries our claim, our evidence, and
the number we filed it under.

### Accessibility rules

Consistent with `citation-linking.md`, and non-negotiable:

- **Real text in the flow.** Not a tooltip, not an icon, not hover-revealed
  content. Hover-only content is unavailable on touch and WCAG 1.4.13 makes it
  difficult to implement correctly; there is no reason to take that on for
  content this short.
- **No icon-only affordance.** A `?` glyph reads as "help" or "unknown," not
  "the source contains an error." If an icon is used at all it is decorative
  (`aria-hidden`) and accompanies the text; it never replaces it.
- **Never color alone** (WCAG 1.4.1). The note is distinguished by its label
  ("Editorial note"), its own block, and a non-color affordance.
- **Semantically an aside**, not a heading level — it must not disrupt the
  heading outline a screen-reader user navigates by.
- **Named, not implied.** The note begins with the words "Editorial note" so its
  status as our commentary rather than statute text is unambiguous when read
  aloud out of context.

### Chapter indexes

The chapter listing is our navigational construction, not source text, so it
lists the **filed** number — `§634G-2` — in sorted position. A section whose
identity was corrected is therefore reachable from its chapter index, which is
the whole point of correcting the identity.

*Open question:* whether the index entry should also carry a marker that the
section has an anomaly, or whether discovering it on the page is enough.

---

## Search

This design has one real consequence worth naming: the page heading reads
`§643G-2` while the URL and index entry read `§634G-2`. A reader searching for
either number must find this page.

They do, because **the editorial note contains both numbers as plain text**, and
the note is rendered into the page that Pagefind indexes. The note is not
decoration — it is the mechanism that makes the corrected number findable, which
is precisely the job a redirect would otherwise have done, without publishing a
URL for a section that does not exist.

This must be an explicit test when Pagefind is wired up: search `634G-2` and
search `643G-2`, and confirm both return this section.

---

## Interaction with citation linking

`corrections.json` doubles as an **alias table for the resolver**, exposed by
`sectionNumberAliases()`. Only conclusive corrections to section numbers produce
an alias — a flagged anomaly has no target to point at.

If some other section's text cites `§643G-2`, the naive resolver finds no such
section and drops it into the unresolved pile. With the corrections file loaded,
`observed → corrected` resolves the citation to the right page — and the link
should carry the corrected target while the visible link text stays as the
citing document wrote it, which is the same identity/text split as above.

More generally: `citation-linking.md` treats the unresolved-candidate count as
the project's quality metric. Every unresolved candidate is one of

1. a parser or detector gap,
2. a genuine reference to something outside the corpus, or
3. **a source anomaly**.

Triaging that pile is how additional entries to this file get found. The three
buckets should be reported separately rather than as one number.

---

## The errata page

The corpus-wide list of anomalies is worth publishing as a page of its own —
every discrepancy, its evidence, and what we did about it.

It is genuinely useful to anyone doing legal research in this corpus, and more
importantly it makes our editorial choices auditable rather than hidden. A site
that silently corrects its source is asking to be trusted; a site that publishes
its corrections ledger has earned it.

---

## Known anomalies

| Section | Anomaly | Confidence | Status |
|---|---|---|---|
| `§634G-2` | Source heading reads `§643G-2`; chapter 643G does not exist | conclusive | recorded 2026-09-09; corpus re-parsed |

Expected to grow once the resolver's unresolved pile is triaged against the full
corpus.

---

## Open questions

1. **Chapter index markers** — should an index entry signal that a section
   carries an anomaly, or is the note on the page sufficient?
2. **Non-`sectionNumber` fields.** The model is general, but every known case so
   far is a number. Whether a garbled *title* or a malformed *history* line
   deserves the same treatment is untested — a title typo is lower-stakes than a
   number and the note may be heavier than the error warrants.
3. **Upstream reporting.** These are reportable to the Revisor of Statutes. If
   an error is ever corrected upstream, a re-scrape will surface the fix as a
   diff, and the corrections entry then needs retiring — which argues for the
   parser warning when a correction's `observed` value no longer appears in the
   source.
