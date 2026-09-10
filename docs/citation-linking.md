# Citation Linking

**Last updated**: 2026-09-09
**Status**: design, not yet implemented

The primary outcome of this project: the HRS as published is a set of flat
`.htm` files in which every reference to another statute is dead text. Turning
those references into resolved, accessible links is the value the scrape exists
to enable.

This document is the grammar and the hazard list. It is written *before* the
matcher so the matcher can be tested against it.

---

## Evidence base

Measured against the 757-section sample in `data/parsed` (357 `docType: "hrs"`,
371,668 chars of body text). **This sample is Volume 1 heavy** — it over-weights
chapters 1–42 and the six non-HRS directories, and contains zero examples of the
colon/article form (`§431:1-100`) that covers ~3,000 files elsewhere in the
corpus. Counts below are therefore indicative of *shape*, not of frequency
across the full corpus. Re-run the profiling after the full scrape before
treating any count as final.

**Update 2026-09-09** — the full scrape is complete: 23,373 sections in
`data/parsed`, including **3,129 colon/article numbers**. The blind spot noted
below is now measurable. Every count in this document still comes from the old
757-section sample and none of them have been revisited yet; that re-profiling
is step 4 in `progress.md`.

---

## The core design decision: resolve, don't match

Most implementations of this treat citation linking as a regex problem: find
something that looks like a section number, wrap it in an `<a>`. That is where
the errors come from, because a regex has no way to know whether the thing it
matched *exists*.

This project has something those implementations did not: **`data/manifest.json`
is a complete inventory of all 24,505 files**, which yields the exact set of
valid section numbers. So the pipeline should be three stages, not one:

1. **Detect** — find candidate citation spans, generously. Over-matching is
   recoverable here.
2. **Resolve** — look each candidate up in the known-sections index. This is the
   stage that makes the difference.
3. **Emit** — link what resolved; leave what did not as plain text, and *record*
   it.

Stage 3's rejects are the quality metric. A run that produces 400 unresolvable
candidates is telling you exactly where the grammar is still wrong, and that
number should be tracked run over run. Silent linking to a section that does not
exist is the failure mode to design against — a wrong link in a legal document
is worse than no link.

**Triage the rejects into three buckets, not one number.** An unresolved
candidate is either (1) a detector or grammar gap, (2) a genuine reference to
something outside the corpus, or (3) an error in the source document. Only the
first is a bug in this code, and collapsing all three into one count hides
whether the number is going down for the right reason. Bucket 3 is how new
entries to `data/corrections.json` get found — see `source-anomalies.md`.

That file also doubles as an **alias table for the resolver**: a citation to
`§643G-2` resolves through `observed → corrected` to `§634G-2` rather than
falling into the unresolved pile. The link target is the corrected section; the
visible link text stays as the citing document wrote it, which is the same
identity/text split `source-anomalies.md` applies to headings.

---

## Forms observed

### HRS section references

| Form | Example | Notes |
|---|---|---|
| `section C-S` | `section 26-34` | the common case |
| `section C-S` with letter chapter | `section 6E-43`, `section 10H-4` | chapter carries a letter suffix |
| decimal | `section 441-5.5`, `section 11-15.3` | see period hazard below |
| subsection | `section 11-17(a)`, `section 231-3(b)` | target is the section; `(a)` is not separately addressable |
| elided list | `sections 92-3, 92-7, and 92-9` | items 2..n have no keyword |
| conjunction | `sections 11-25 and 11-26` | two separate links |
| range | `sections 11-1 to 11-9` | see open questions |
| `§` symbol | `§6E-8`, `§§14` | 36 occurrences in sample; `§§` marks a plural |
| chapter | `chapter 25`, `chapter 91`, `chapter 431K` | resolves to a chapter index page |
| colon/article | `§431:1-100` | **absent from this sample**; ~3,000 files corpus-wide |

### Cross References annotations

Already extracted as a separate field, and denser in citations than the body —
41 entries in the sample, nearly all ending in one:

```
Taking a monk seal prohibited, see §195D-4.5.
Reapportionment, see chapter 25.
```

These are the highest-value, lowest-risk linking target: short, uniform, and
almost pure citation. Worth doing first as a proving ground for the resolver.

---

## Hazards

Each of these is a real case from the sample, and each one breaks a naive
pattern.

### 1. The period is ambiguous — and it is close to a coin flip

This is the single most dangerous case. `section 11-97. A person who...` ends a
sentence. `section 6E-43.6` is a decimal section number. The character is
identical.

Measured in the sample, on the pattern `section \d+[A-Z]?-\d+[A-Z]?\.`:

| | count |
|---|---|
| period is sentence-end | 34 |
| period is a decimal point | 29 |

**A matcher that guesses either way is wrong roughly half the time.**

Rule: consume `.` into the number **only when the next character is a digit**.
This also handles the compound case correctly — in `section 6E-43.6.` the first
period is consumed (digit follows), the second is not (end of sentence).

Note that decimals concatenate under the filename grammar: `HRS_0011-0001_0005_0002`
is `§11-1.52`, a single decimal, *not* `11-1.5.2`. The body-text form matches
this (`11-1.52`), so the resolver's index and the detector agree — but only if
the number is normalized through the same path as `filenameToSectionNumber`.

### 2. Not every "section N" is an HRS section

```
section 203 of the Hawaiian Homes Commission Act, 1920, as amended
section 106 of the National Historic Preservation Act of 1966
sections 5(c) and 5(d) of the Act of March 18, 1959
```

A bare number with no chapter-section hyphen, followed by `of the <Proper Noun>
Act`, is an external citation. Linking `section 203` to HRS chapter 203 would be
a confident, wrong, legally misleading link.

The trailing context has to be inspected before emitting. The two guards that
cover the observed cases:

- a bare number (no `C-S` hyphen structure) is **not** an HRS section reference
  by default — HRS citations are always chapter-section
- an immediately following `of the …Act` / `of the Act of <date>` suppresses the
  candidate regardless of shape

Related federal forms present in the sample and to be excluded: `Public Law`,
`United States Code` / `U.S.C.`, `C.F.R.`, `Title 40 United States Code 187`.

Some of these deserve links *eventually* — HHCA §203 is in this corpus, under
`06-HHCA` — but only via a deliberate cross-document mapping, never by falling
through to the HRS namespace.

### 3. Self-references are not citations

`this section`, `this chapter`, `this part` are by far the most common thing
following the keyword (28 of the sample's `section <lowercase-word>` hits are
`section shall`, i.e. the tail of "this section shall"). They must not be
linked, and they are excluded for free by requiring a digit to follow the
keyword.

Whether "this section" should link to the current page's own anchor is an open
question — see below. Default: no.

### 4. Elided lists drop the keyword

`sections 92-3, 92-7, and 92-9` — a matcher anchored on the word `section`
produces one link and leaves two dead. After matching a plural keyword, the
list must be continued across `,` / `and` / `or` separators for as long as the
following tokens keep the citation shape.

Care needed: the list ends at the first token that is not a citation, and
`sections 11-26 and 11-51, and the proceedings shall be had` shows that a comma
followed by `and` does *not* always continue the list.

### 5. Non-breaking hyphens

The corpus writes section numbers with U+2011 (non-breaking hyphen) throughout,
not only in headings. `parser.ts` already normalizes hyphen variants for heading
matching; the citation detector must use the same normalization, and must not
normalize U+2013 (en dash), which is prose punctuation.

### 6. Article-form numbers use a colon

`§431:1-100` — the colon separates chapter from article. Absent from this
sample but present in ~3,000 files. A pattern built only against Volume 1 will
miss all of them, which is the most likely way for this work to look finished
while being 12% wrong.

---

## Accessibility

The goal is a document that is genuinely navigable, not one that is decorated
with links.

- **Link text is the citation itself.** `<a href="…">section 26-34</a>` — never
  "here", never an icon alone. The visible text is already the accessible name.
- **Disambiguate for screen-reader users scanning a link list.** Many links on a
  page will read as bare numbers out of context. Give each an `aria-label`
  carrying the target's title: `aria-label="section 26-34, Department of
  business, economic development, and tourism"`. That title is already parsed
  and stored, which makes this nearly free.
- **Do not link the same citation repeatedly** within a short span; repeated
  adjacent links to one target add noise to link-list navigation.
- **Never rely on color alone** to mark a link (WCAG 1.4.1). Underline, or carry
  a non-color affordance.
- **Unresolved citations stay plain text.** No dead links, no `href="#"`, no
  disabled-link pattern.
- **Mark external citations as external** where they are linked at all, with the
  destination named in the accessible name rather than implied by an icon.
- If subsection anchors are added later, `id` targets must be stable across
  re-scrapes — the anchor is a URL contract and content changes must not silently
  break it. This interacts with the versioning question in `project-plan.md`.

---

## Open questions

1. **Ranges.** `sections 11-1 to 11-9` — link only the two endpoints, or expand
   to every section in between? The manifest makes expansion *possible*, but the
   expanded set is an interpretation, and a range in a statute does not always
   correspond to the sections that currently exist. Leaning toward linking
   endpoints only, and recording the range as structured data separately.
2. ~~**Should the citation graph be stored?**~~ **Decided 2026-09-09**: the
   graph is built in memory at build time and baked into the rendered HTML.
   24,505 sections is small enough that this needs no database. Emitting it
   alongside the site as a `citations.json` (from, to, offsets, resolved) is
   still worth doing — it makes "what cites this section?" answerable for
   backlinks, and lets rendering be regenerated without re-detecting.
3. **`this section` / `this chapter`** — link to self, or leave plain? Leaving
   plain is safer and less noisy.
4. **Cross-document targets.** HHCA, the constitutions and the Organic Act are
   in the corpus but numbered as prefixed identifiers, and they are cited from
   HRS text. Linking them requires the proper-citation work already noted as a
   gap.
5. ~~**Where does rendering live?**~~ **Decided 2026-09-09**: a Bun build step
   reads `data/parsed`, resolves citations, and writes static HTML. Pages are
   rendered from the structured fields, never from `bodyHtml` — that is what
   gives us control over the markup for the accessibility rules above. See
   Storage & Delivery in `project-plan.md`.

---

## Suggested order

1. Profile the **full** corpus once the scrape completes; revisit every count here.
2. Build the resolver + known-section index off the manifest.
3. Run detection over Cross References annotations first — short, uniform,
   high signal, easy to eyeball.
4. Extend to body text, tracking the unresolved-candidate count as the metric.
5. Decide the storage question (open question 2) before emitting any markup.
