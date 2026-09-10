# Citation Linking

**Last updated**: 2026-09-09
**Status**: implemented — `src/citations.ts`, `src/resolver.ts`. Rendering is a preview only.

The primary outcome of this project: the HRS as published is a set of flat
`.htm` files in which every reference to another statute is dead text. Turning
those references into resolved, accessible links is the value the scrape exists
to enable.

This document is the grammar and the hazard list. It is written *before* the
matcher so the matcher can be tested against it.

---

## Evidence base

**Re-profiled 2026-09-09 against the full corpus**, replacing the earlier
757-section sample. Every count below is measured, not estimated.

| | |
|---|---|
| Sections | 23,373 |
| Body text | 32,222,208 chars (87× the old sample) |
| Annotation text | 5,301,692 chars |
| Cross References entries | 1,805 |
| Resolver index | 22,972 HRS section numbers + 1,114 chapters |

The chapter index comes from `manifest.json`, **not** from the parsed sections.
293 chapters are index-only directories whose sections were all repealed: the
chapter page still exists and is still a valid link target, but no section file
carries that chapter number. Building the index from parsed sections silently
loses all 293 and makes those citations look unresolvable.

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

Keyword volume across body text:

| Form | Count |
|---|---|
| `section N…` | 16,503 |
| `sections N…` (plural, opens a list) | 1,506 |
| `chapter(s) N` | 6,085 |
| `§` / `§§` | 2,803 |
| colon/article form (`431:10A-104`) | 3,425 |
| `this section` / `chapter` / `part` / `subsection` | 27,685 |

The self-reference count is the single largest category in the corpus and is
excluded for free by requiring a digit after the keyword.

Forms that must be excluded rather than resolved:

| Form | Count |
|---|---|
| `of the …Act` | 529 |
| `United States Code` / `U.S.C.` | 813 |
| `C.F.R.` / Code of Federal Regulations | 366 |
| `Public Law` | 151 |

### Cross References annotations

1,805 entries, of which **1,038 (58%) contain at least one citation**. The
earlier sample suggested "nearly all"; at full scale it is closer to half, and
the rest are prose pointers with no number.

They remain the best proving ground: 1,781 candidates resolve at **95.7%** with
only 6 unresolved (0.34%) — the cleanest ratio anywhere in the corpus.

## Hazards

Each of these is a real case from the corpus, and each one breaks a naive
pattern.

### 1. The period is ambiguous — 2:1, not a coin flip

This is still the most dangerous case. `section 11-97. A person who...` ends a
sentence. `section 6E-43.6` is a decimal section number. The character is
identical.

Measured across the **full corpus**, on the pattern `section \d+[A-Z]?-\d+[A-Z]?\.`:

| | count | share |
|---|---|---|
| period is sentence-end | 2,606 | 65.4% |
| period is a decimal point | 1,381 | 34.6% |

The old sample read 34 / 29 and this document called it "near a coin flip." At
scale it is closer to 2:1 — the sample over-weighted decimals. **The rule does
not change**: a matcher that always consumes the period is wrong a third of the
time, and one that never consumes it is wrong two thirds of the time.

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

**The bare-number rule is now proven, not assumed.** Every one of the 22,972 HRS
section numbers contains a hyphen — zero exceptions. So "a bare number is not an
HRS section reference" is a property of the corpus, not a heuristic. 4,903 body
candidates are rejected on that rule alone.

**The danger is concentrated in `chapter N`, not in `section C-S`.** Measured
against foreign-law markers immediately adjacent to the citation:

| | candidates | foreign-adjacent |
|---|---|---|
| `section C-S` | 16,794 | 1 (0.01%) |
| `chapter N` | 6,160 | 38 (0.62%) |

And the single section hit is a false alarm: `section 490:1-201 of the Uniform
Commercial Code` is correct, because HRS chapter 490 *is* Hawaii's UCC. So the
chapter-section shape is effectively collision-free with federal citation
numbering, while a bare chapter number is not:

```
title 12 United States Code chapter 53, subchapter V
chapter 11 of the Internal Revenue Code
subchapters I and II of Chapter 37 of Title 38 of the United States Code
Social Security Act (August 14, 1935, Chapter 531, 49 Stat. 620)
```

All 38 are `chapter N` adjacent to a named foreign code. The guard has to look
**both directions** — `<foreign code> chapter N` and `chapter N of <foreign
code>` are both common.

Related federal forms to exclude: `Public Law` (151), `United States Code` /
`U.S.C.` (813), `C.F.R.` (366).

Some of these deserve links *eventually* — HHCA §203 is in this corpus, under
`06-HHCA` — but only via a deliberate cross-document mapping, never by falling
through to the HRS namespace. **149 non-HRS section numbers are bare** (`2`,
`5`, `215`) and **89 collide outright** with HRS numbers (`1-2` is both HRS §1-2
and CONST §1-2), so the two namespaces must stay separate in the index. Merging
them is how `section 2` acquires a confident link to the Admission Act.

### 3. Self-references are not citations

`this section`, `this chapter`, `this part` are by far the most common thing
following the keyword — **27,685 occurrences**, more than every real citation in
the corpus combined. They must not be linked, and they are excluded for free by
requiring a digit to follow the keyword.

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

### 5. Non-breaking hyphens — already handled upstream

The corpus writes section numbers with U+2011 throughout. `parser.ts` normalizes
hyphen variants in `clean()` before any text reaches `bodyText`, and a scan of
the full corpus confirms **zero** remaining U+2010/2011/2012 in parsed bodies.
The detector inherits this for free. U+2013 (en dash) is prose punctuation and
is correctly left alone.

### 6. Article-form numbers use a colon

`§431:1-100` — the colon separates chapter from article. This was the sample's
blind spot; the full corpus has **3,425 occurrences in body text** across 3,129
sections. A pattern built only against Volume 1 misses all of them, which was
the most likely way for this work to look finished while being 12% wrong.

### 7. Hawaii Administrative Rules look exactly like HRS sections

New in the full-corpus profile, and the most dangerous find. HAR citations use a
**title-chapter-section** form whose first two components are character-identical
to an HRS chapter-section number:

```
This section and §13-300-51, Hawaii administrative rules (HAR)
violated Hawaii administrative rule §12-46-108
the validity of §3-122-66 (repealed), Hawaii administrative rules
```

A detector anchored on the HRS shape matches `13-300` and silently drops the
trailing `-51`, producing a confident link to an HRS section that has nothing to
do with the rule being cited.

**The third component is the tell.** A trailing `-NN` after an otherwise valid
HRS-shaped number means the citation is not an HRS section. 51 occurrences in
annotations (48 of them within a window of an explicit "Hawaii administrative
rule" marker) and 5 in body text — small, but each one is a wrong link in a
legal document, which is the failure this design exists to prevent.

### 8. Annotations cite superseded numbering

`H.R.S. §711-77` in the Penal Code commentary refers to the **pre-1972** code,
not to the current §711-77. 164 citations in annotations carry an `H.R.S.` or
`R.L.H.` prefix, which in that context marks the *former* compilation rather
than the current one.

Resolving these against today's index produces a link that is confidently wrong
in the most misleading possible way: it points at a real section that says
something unrelated. The `H.R.S.`/`R.L.H.` prefix inside an annotation should
suppress the candidate.

---

---

## Results

`bun run profile-citations` runs the detector over the corpus and reports the
quality metric. Rejections are reported **by reason**, not as one total: "bare
number" is the detector working correctly, "unresolved" is its to-do list, and
collapsing them hides whether the number is falling for the right reason.

### Body text

| | count | share |
|---|---|---|
| Candidates detected | 30,850 | |
| **Linked** | 25,555 | 82.84% |
| Rejected: bare number, no `C-S` shape | 5,068 | 16.4% |
| Rejected: foreign law (hazard 2) | 54 | 0.18% |
| Rejected: administrative rules (hazard 7) | 11 | 0.04% |
| Rejected: superseded numbering (hazard 8) | 4 | 0.01% |
| **Unresolved** | 158 | 0.51% |

158 unresolved across 32 million characters. Triaged into the three buckets:

- **Genuine external references** — federal citations that look HRS-shaped:
  `1395i-3` and `1320a-7` (Social Security Act), `9601-9675` (CERCLA),
  `1400Z-1`, `80a-1`. These are correct rejections.
- **References to repealed sections** — `291-4.4`, `291-4.5` ("as that section
  was in effect on December 31…"), `445-222`, `57-43`. The statute is
  deliberately pointing at text that no longer exists. Also correct rejections,
  and arguably worth surfacing to the reader as such rather than silently
  leaving plain.
- **Detector gaps** — the smallest bucket, and the one that is actually a bug.

The headline: **the residual error rate is dominated by things that *should not*
be linked**, which is what the resolve-don't-match design was for.

### Annotations

Much noisier than body text, and they are not one population:

| Block | Candidates | Linked | Unresolved |
|---|---|---|---|
| Cross References | 2,192 | 94.98% | 0.55% |
| Attorney General Opinions | 173 | 68.79% | 1.16% |
| Case Notes | 3,439 | 79.01% | 3.72% |
| Commentary | 1,734 | 72.26% | 6.06% |

**Hazards 7 and 8 are what make Case Notes and Commentary usable.** Before those
guards, Case Notes ran at 7.24% unresolved and Commentary at 10.92%; the two
guards roughly halve both, and — more importantly — the citations they remove
would otherwise have become *wrong links* rather than unresolved ones. Case Notes
alone carries 55 administrative-rule citations and 81 superseded ones.

`crossReferences` remains the cleanest population at **95%** — confirmation that
it was the right proving ground.

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
   gap. The profile sharpened the risk: **89 non-HRS numbers collide outright
   with HRS numbers** and 149 are bare. Until that mapping exists, the two
   namespaces stay separate and non-HRS citations stay plain — the failure mode
   is `section 2` acquiring a confident link to the Admission Act.
5. **Repealed-section references.** A visible share of the unresolved pile is
   the statute deliberately pointing at text that no longer exists —
   `section 291-4.4 as that section was in effect on December 31, 2001`. There
   is nothing to link, but leaving it as undifferentiated plain text loses the
   fact that we *know* why. Worth considering a marked-but-unlinked treatment,
   which interacts with the editorial-note channel in `source-anomalies.md`.
6. ~~**Where does rendering live?**~~ **Decided 2026-09-09**: a Bun build step
   reads `data/parsed`, resolves citations, and writes static HTML. Pages are
   rendered from the structured fields, never from `bodyHtml` — that is what
   gives us control over the markup for the accessibility rules above. See
   Storage & Delivery in `project-plan.md`.

---

## Suggested order

1. ~~Profile the full corpus~~ — done 2026-09-09; every count above is measured.
2. Build the resolver + known-section index off the manifest. Two things the
   profile settled: chapters must come from the manifest (293 are index-only),
   and the HRS and non-HRS namespaces must stay separate (89 numbers collide).
3. Run detection over `crossReferences` first — 95.7% resolve, 1,805 entries,
   short and uniform enough to eyeball the whole output.
4. Extend to body text. The prototype baseline to beat is 82.9% resolved / 0.6%
   unresolved, with the residual dominated by correct rejections.
5. Only then annotations, and only with hazards 7 and 8 implemented — Case Notes
   and Commentary carry HAR citations and superseded numbering that will
   otherwise produce confidently wrong links.
6. Decide the storage question (open question 2) before emitting any markup.
