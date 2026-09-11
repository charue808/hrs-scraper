# HRS Scraper - Implementation Progress

**Last updated**: 2026-09-10

## Status: the site builds, and reading it has been paying for itself

`bun run build` turns the committed corpus into **24,503 files in ~4.6 seconds**
— 23,373 sections, 1,114 chapters, 14 volumes, a home page and one stylesheet —
with **0 broken internal links** across all 24,503 distinct hrefs. `bun run
serve` browses it at localhost:3000. 161 tests.

Next: Pagefind, then `citations.json` for backlinks. The one remaining
correctness gap is still cross-document targets (the 424 non-HRS files).

## 2026-09-10 (second pass) — five defects found by reading the built site

The build existing is what made these findable. All five came from clicking
around localhost, not from any metric.

### The bracket convention, which we had wrong

`isUncodified` rendered as "not yet codified". Nothing in the corpus supports
that, and **7,859 sections — 33.6% — carry a bracketed heading**, which is far
too many to be awaiting codification when they are printed in the HRS.

What the corpus actually says, in its own annotations: *"Bracketed words ...
added by revisor"* (§286C-1), *"Part heading added by revisor pursuant to
§23G-15"* (§321-561), and Commentary describing the legislature *deleting the
brackets* to ratify revisor-supplied material (§712A-4). §23G-15(1) grants the
revisor authority to number and renumber sections. **Brackets mark material
supplied by the revisor rather than enacted by the legislature.**

A competing hypothesis — that bracketed sections come from acts the revisor
split, which the history writes as `pt of §1` — was tested and **failed**: 79.8%
of bracketed versus 70.6% of unbracketed. No signal, so it is not claimed.

Pages now say "heading supplied by the revisor", scoped to the heading on
purpose: the statute's text is enacted law either way, and a phrase like "not
enacted" would invite exactly the wrong reading of a legal document. The field
is still named `isUncodified` — renaming rewrites all 23,373 files, so it is
tracked as its own commit. Written up in `project-plan.md`, The bracket
convention.

### Chapter 37 showed 4 of its 7 parts

Reported as "the source lists more sections than we have". The sections were
complete (62 parsed, 62 in the manifest) and the source's own listing does say
`37-1 to 14 Repealed` as a single entry, which we match. The *parts* were
missing — and the three that vanished were bracketed: `[PART IV. THE EXECUTIVE
BUDGET]`, `[PART VI. COUNCIL ON REVENUES]`, `[PART VII.] ROUTINE REPAIR AND
MAINTENANCE`. `STRUCTURAL_RE` had no optional leading `[`, unlike `HEADING_RE`
directly above it. **298 sections across 119 chapters**, with the banner text
left stranded in the body as a stray paragraph.

The same investigation found a second bug: **1,243 of the 1,247 sections with a
`partHeading` repeated it as their first body paragraph**, so it rendered twice.
The banner is now *moved* into `partHeading`, not copied. That is also what was
producing the doubled "ARTICLE I" on the constitution pages — not a non-HRS
quirk after all.

Together: 1,556 files changed on reparse. Empty `bodyText` went 36 → 41, the five
new ones being banner-only pages whose entire content is now correctly held in
`partHeading`.

### Roughly 1,600 citations were never linked

Scanning rendered body text for numbers that resolve against the index but carry
no link found 343 in the first 5,002 sections. Two causes:

- **A singular keyword followed by a list.** `required by section 667-22 or
  667-55`, `pursuant to section 6E-43 or 6E-43.6`. The continuation walk was
  gated on a plural keyword, so everything after the first number was dropped.
  Ordinary HRS drafting; the gate was simply a wrong assumption.
- **Bracketed numbers.** `established in section [226-55]` — the revisor
  convention again, in running text.

Removing the gate added **1,152 links to body text** (82.84% → 83.31%) with
**unresolved unchanged at 48**, which is the shape a correct fix has. The
bracket fix needed care: the closing bracket is matched as its own group and
dropped when no opening one was consumed, or `[§11-1.52]` yields the link text
`§11-1.52]`.

### Statute bodies are now outlined

The HRS nests `(a)` → `(1)` → `(A)` → `(i)` and every level rendered as a flat
paragraph. Indentation rather than `<ol>`: the enumerators are enacted text, so
list markers would either duplicate or replace them.

Depth comes from the order each marker *kind* first appears in the section, not
a fixed table — many sections start at `(1)` with no `(a)` above, and a fixed
table would indent those as though a level were missing. Two judgement calls are
documented rather than hidden: `(i)` is read as a letter when a lowercase level
is open and its last marker was `h`, otherwise as a roman; and an unmarked
paragraph keeps the current depth, which indents a trailing parent-level
paragraph one step too far but breaks far fewer paragraphs than flattening.

### Ranges: noted, not changed

Raised as a research-experience question rather than a defect, and recorded as
open question 5 in `citation-linking.md`. Current handling is correct and
agreed — endpoints linked, span in the graph, middle not linked because there is
no text to attach to. The options if it ever needs more are listed cheapest
first, along with the constraint that rules out the obvious one: the site does
not inject text the legislature did not write.

### Two more from the same reading

- **Bracketed banners looked like a bug.** Fixing the parser made
  `[PART IV. THE EXECUTIVE BUDGET]` appear, brackets and all. The brackets come
  off for display now and the note is stated in words beside the banner — which
  is the same trade the parser already makes for a bracketed *section* heading,
  where it strips the brackets and `isUncodified` carries the meaning. Nothing
  in the corpus changes; this is display only.
- **Only section pages had a source link.** Chapter, volume and home pages had
  no footer at all, which made them look like a different site. Every page that
  stands for a real document on the source server now links back to it: a
  section to its file, a chapter to its index page, a volume to its directory,
  home to `hrscurrent/`. `02-HNP` and `03-ORG` have no index page on the server,
  so they get no footer rather than a dead link.

### Also

`src/serve.ts` — the built site uses extensionless directories, which is what a
real static host resolves and `file://` does not, so it was not browsable off
disk. Development only; confines every request to the output directory before
touching the filesystem.

## 2026-09-10 — The site build, and a class of wrong link it exposed

### The build

`src/build.ts` (the driver) and `src/site.ts` (the markup) replace
`src/render.ts`, which was a one-chapter preview. Keeping two renderers would
have meant two copies of the markup rules, drifting apart; `bun run build
-- --chapter 26` covers what the preview was for.

- **URLs are extensionless directories.** `/hrs/26-34/index.html` serves
  `/hrs/26-34`, which needs no rewrite rules on any static host. Same file count
  as flat `.html` files — directories are free.
- **Navigation**: home → volume → chapter → section, with a breadcrumb on every
  page and previous/next within a chapter.
- **A slug-collision check that exits non-zero.** The scraper already guards
  duplicate section numbers; this is the same failure one layer down, and
  24,503 files is far too many to notice it by eye.
- **The index is built from the corpus already in memory** rather than re-reading
  23,373 files (`buildIndex(preloaded)`).

Verified: every one of the 24,503 distinct internal hrefs resolves to a file
that exists, and `bun run reparse -- --dry-run` still reports
`unchanged 23373 changed 0`, so byte-stability is intact.

### Hazard 9: legislative history was producing 971 confidently wrong links

Reading the built pages — not the counts — turned this up, the second session
running that reviewing real output beat reviewing metrics.

The bracketed history at the end of a section records where that section has
*lived*, not what it refers to. `§502-13`'s history reads `RL 1955, §343-7` —
its number in the 1955 Revised Laws — and the renderer was linking it to today's
§343-7, *Limitation of actions*. Measured across the corpus, history holds 5,222
resolvable citations: **4,251 point at the citing section's own page and 971
point at a different section, every one of them wrong.** Useful links: zero.

Not fixable in the detector. Hazard 8's guard matches `H.R.S.`, `R.L.H.` and
`RLH`, but history writes the marker as bare `RL 1955`; and a *former* HRS
number is character-identical to a current one. So the decision is at block
level: **history is rendered as plain text.** Annotations are unaffected and
stay linked — 0 of their links sit behind a marker hazard 8 does not cover.

**Why it survived a full session.** `profile-citations` measured body text,
cross references and annotations — never `history`. The preview renderer linked
it anyway, so 5,222 links were rendered and never counted. The profiler now
reports history as its own block precisely because the site does not link it.
A rendered block that nothing measures is where the next one of these hides.

### Chapter index pages now yield more than a title

293 chapters have no sections at all — every one was repealed, so no file in
`data/parsed` carries their number. A chapter page built from parsed sections
alone renders 293 blank pages.

Their index pages are not blank. Chapter 2's says `REPEALED. L Sp 1977 1st, c 8,
§3.` with a cross reference to chapter 23G — exactly the kind of dead pointer
this project exists to link. `parseChapterIndex` now also returns `notes` and
`annotations`, scoped to what follows the **live** `CHAPTER n` banner. That
scoping is the whole trick: an index page often opens with a division/title
table of contents carrying its own Cross References (chapter 91's belong to
TITLE 8), and a superseded `[OLD]` banner brings its own as well. Measured
across the corpus: 371 chapters have notes, 629 have their own annotations, and
none of the 293 has a section listing.

`data/chapters.json` also became deterministic. Two chapters (`01-USCON`,
`05-CONST`) have more than one index page, and the worker pool's completion
order decided which one won — nondeterminism in a committed file that is read as
a diff.

### Smaller things

- **23 pages were dead ends.** The 36 sections with an empty `bodyText` turned
  out to be 23 `Renumbered as §X.` and 13 `Reserved.` — not a defect, the
  correct parse. But on those 23 the title *is* a citation and the only content
  the page has, and the renderer was escaping it rather than linking it. Titles
  are now linkified: 29 titles contain a citation and 28 resolve.
- **`partHeading` marks only where a part begins** — it is null on every section
  after the first (44 of chapter 26's 47). Grouping a chapter's contents by "the
  value changed" started a fresh unlabelled list under each part's first
  section. The heading is carried forward now.
- **The resolver's non-HRS guard was a no-op.** `if (!/^\d/.test(chapter.number))
  continue;` claimed to skip `01-USCON` and `05-CONST` — both of which begin
  with a digit, so it skipped nothing. Harmless (the citation grammar cannot
  produce a chapter number with letters after a hyphen, and `classify()` rejects
  hyphenated chapter numbers first) and the documented index size of 1,114 was
  always the real behaviour, so the comment was corrected rather than the code.



The destination changed on 2026-09-09: the product is a **static site**, not a
Postgres database. See the session note below and Storage & Delivery in
`project-plan.md`.

This document records what changed and why. `project-plan.md` is the design
reference for the system as built.

## 2026-09-09 — Citation questions closed

The three open questions that were still leanings are decided, and closing them
turned up 20 wrong links.

- **Ranges — endpoints in the markup, the whole span in the graph.** Rendering
  settles itself: `sections 11-1 to 11-9` offers no text for §11-5 to attach a
  link to, so expansion is not renderable inline. But the statute means the span,
  and without it a section cited only inside a range looks uncited, so
  `expandRange()` contributes 2,722 graph edges.
- **`this section` — plain.** 27,685 occurrences; linking them would flood
  link-list navigation and add nothing.
- **Sections no longer in the code — marked, not linked.** 325 references point
  at a section whose chapter still exists. Counting them as "unresolved" hid that
  the detector was working perfectly, so they became their own bucket. Called
  `absent-section`, not `repealed`: absence is verifiable, the reason is an
  inference, and this project does not assert what it cannot show.
- **Cross-document targets — deferred** until the site build is done. 306 named
  references; the last known correctness gap.

### The `Id.` back-reference — 20 wrong links

Checking the residual turned up hazard 8 in a form adjacency cannot catch.
Commentary cites in runs:

```
1. H.R.S. §703-1.  2. Id. §703-2.  3. Id. §§571-11, 571-12, 571-22.
```

`Id.` means "the same source as the previous citation", so the `H.R.S.` marker
sits sentences away. 91 `Id. §N` citations appear in the annotations and **20
resolved to live sections** — each a confident link to text saying something
other than what the commentary discusses. The guard is conditional: an `Id.`
inherits the superseded context only when the block established one earlier, so
an ordinary back-reference still resolves.

Unresolved rates after the guards:

| Block | No guards | +HAR/prefix | +`Id.`/absent |
|---|---|---|---|
| Case Notes | 7.24% | 3.72% | **0.09%** |
| Commentary | 10.92% | 6.06% | **1.38%** |
| Cross References | 0.96% | 0.55% | **0.00%** |
| Body text | 0.55% | 0.51% | **0.16%** |

## 2026-09-09 — Citation linking implemented; preview renderer

Built the slice the profile was for: resolver, detector, and a renderer crude
enough to throw away but real enough to review by eye.

- **`src/resolver.ts`** — the known-section index. Chapters come from the
  manifest (293 are index-only), the HRS and non-HRS namespaces stay separate
  (89 numbers collide), and `data/corrections.json` supplies aliases so a
  citation to a number the source got wrong still resolves.
- **`src/citations.ts`** — detect, resolve, emit. Every guard maps to a numbered
  hazard in `citation-linking.md`. Rejections carry a reason, because "bare
  number" and "unresolved" mean opposite things.
- **`src/render.ts`** — one chapter to static HTML. No JavaScript, link text is
  the citation itself, `aria-label` carries the target's title, unresolved
  citations stay plain text.
- **`bun run profile-citations`** — the quality metric, reported by reject reason.

Result: **82.84% linked, 0.51% unresolved** over 30,850 body candidates.
`crossReferences` 95%. Case Notes and Commentary improved from 7.24%/10.92%
unresolved to 3.72%/6.06% once hazards 7 and 8 were implemented — and the
citations those guards remove would otherwise have become wrong links.

### One rule loosened, deliberately

The foreign-law guard now applies to **chapter references only**. Measured: of
16,794 chapter-section references exactly one sat next to a foreign-law marker,
and it was a *correct* citation — `section 490:1-201 of the Uniform Commercial
Code`, because HRS chapter 490 is Hawaii's UCC. Hawaii adopts uniform codes under
their own names, so a name-based guard misfires on them; a hyphenated section
number is already validated by the index, which is the stronger check.

### Four defects the renderer surfaced

Building the renderer early paid for itself immediately — none of these were
visible in the counts.

1. **100 titles swallowed their opening subsection marker.** Word writes
   `<b>§26-12 Department of education. </b>(a)<b> </b>The department...`, and
   `(a)` is short enough to look like one of the connectors that hold a split
   heading together. The title gained `. (a)` *and the body lost the marker
   entirely*. Two sections split it further into `(`, `a`, `)` runs, which no
   per-run check can see, so it is now stripped from the assembled heading.
2. **Chapter titles existed nowhere in the static pipeline.** They are parsed
   from the index pages but were only ever written to Postgres. With the database
   demoted to a side tool, nothing labelled a chapter or filled the accessible
   name of a `chapter 91` link. `bun run chapters` now builds
   `data/chapters.json` from the cached index HTML.
3. **252 chapters had no title** because their banner is bracketed —
   `[CHAPTER 30]`, and the variant `[CHAPTER 56 PUBLIC OFF-STREET PARKING
   FACILITIES]` with the title inside the bracket. The same uncodified-bracket
   convention as section headings.
4. **38 chapters were titled `OLD` or `NEW`.** A superseded banner precedes the
   live one — `CHAPTER 14 [OLD]` … `CHAPTER 14 [NEW]` — exactly as `[OLD]` part
   banners precede section headings, and the first match won. Titles that begin
   with a digit ("911 SERVICES", "340B Drug Discount Program") were also being
   rejected by a guard meant to skip the section listing.

Six chapters remain untitled: three reserved ranges
(`[CHAPTERS 807 to 830 RESERVED.]`) and the three non-HRS directories. All
correct.

## 2026-09-09 — Citations re-profiled against the full corpus

`citation-linking.md` was written against a 757-section, Volume-1-heavy sample.
Re-profiled against all 23,373 sections (32.2M chars of body text, 87× the
sample). Every count in that document is now measured. What changed:

- **The period hazard is 2:1, not a coin flip.** 2,606 sentence-ends against
  1,381 decimals (65/35); the sample read 34/29 and over-weighted decimals. The
  rule is unchanged — consume `.` only when a digit follows — but the framing was
  wrong.
- **The bare-number rule is now proven.** All 22,972 HRS section numbers contain
  a hyphen, zero exceptions. "A bare number is not an HRS section reference" is a
  property of the corpus rather than a heuristic.
- **The federal-collision danger is in `chapter N`, not `section C-S`.** Of
  16,794 section references, 1 sits next to a foreign-law marker — and that one
  (`section 490:1-201 of the Uniform Commercial Code`) is correct, since HRS
  chapter 490 *is* Hawaii's UCC. Of 6,160 chapter references, 38 are genuinely
  foreign (`chapter 11 of the Internal Revenue Code`).
- **Two new hazards, neither in the original spec.** Hawaii Administrative Rules
  use a title-chapter-section form character-identical to an HRS number in its
  first two components (`§13-300-51`), so a detector drops the third component
  and links confidently to the wrong thing; and annotations cite superseded
  numbering (`H.R.S. §711-77` means the pre-1972 code), which resolves against
  today's index to a real section that says something unrelated.
- **293 chapters are index-only directories** whose sections were all repealed.
  The chapter page is still a valid link target, so the resolver's chapter index
  must come from `manifest.json`, not from parsed sections — building it from
  sections loses all 293.
- **89 non-HRS section numbers collide with HRS numbers** and 149 are bare, so
  the two namespaces have to stay separate in the index.

A throwaway prototype detector built to these rules resolves **82.9%** of 30,850
body-text candidates with **0.6% unresolved**, and the residual is dominated by
correct rejections (federal citations, references to repealed sections) rather
than by grammar gaps. Annotations are far noisier — Case Notes 7.2% and
Commentary 10.9% unresolved — which is precisely where the two new hazards live.
`crossReferences` resolves at 95.7%, confirming it as the proving ground.

No matcher was built this session; the prototype exists only to size the problem
and is not committed.

## 2026-09-09 — Full scrape complete; QA findings

`bun run scrape --save-html` against the full manifest. **0 failures.**

| | |
|---|---|
| Files processed | 24,505 |
| Parsed sections | 23,373 |
| Chapter index pages | 1,132 |
| Parsed JSON | 154 MB (matched the estimate exactly) |
| Saved HTML | 127 MB |
| Number from the page | 22,832 (97.7%) |
| Number from the filename | 541 |
| Colon/article numbers (`§431:1-100`) | 3,129 |

The 541 filename fallbacks are the 400 non-HRS documents plus ~141 article
banner pages — the known gap, nothing new. The 3,129 colon/article numbers close
the blind spot `citation-linking.md` flagged: that form was entirely absent from
the 757-section sample and is now available for profiling.

Page-derived and filename-derived numbers disagreed on only **9 of 22,832**
files. Every defect below came out of those 9.

### Defects found — all fixed, corpus re-parsed

Re-parsed with `bun run reparse` (new; see below): 23,373 sections, 755 pages
fetched to fill gaps in the HTML cache, 0 failures, **0 duplicate section
numbers**.

| | before | after |
|---|---|---|
| Duplicate section numbers | 3 | 0 |
| Range fragments in titles | 274 | 0 |
| Titles with a stray `]` | 105 | 1 (legitimate) |
| Lowercase letters in section numbers | 0 (latent) | 0 (fixed at source) |
| `numberSource` | page 22,832 / filename 541 | page 22,560 / filename 541 / page-range 272 |

Two fields were added to `ParsedSection` in the same pass, deliberately before
the baseline commit: `covers` (the span a range page stands for) and
`titleIsSupplied` (13 sections). Adding an always-present field rewrites all
23,373 files, which is free now and expensive once the corpus is committed.

1. **Range headings — 274 files.** Initially sized at 4 from the duplicate
   collisions, which caught only the cases that happened to collide. Pages headed
   `§515-10 to 515-12 REPEALED.` stand for a span of sections, and the range
   expression bled into the title. Two separate problems:

   - *Fragment titles (all 274).* `HEADING_RE` takes everything after the number
     as the title, so the title read `"to 515-12 REPEALED."` instead of
     `"REPEALED."` and the span was lost as prose.
   - *Wrong section number (3 files).* Only where the file is not the range's
     start. `HRS_0327-0031` took the §327-21 banner of an `[OLD]` part above it;
     `HRS_0425-0180` is the range's *end*, so matching the heading to the
     filename does not help on its own.

   Fixed by parsing the range: `covers` records the span, the section number
   comes from the filename on a range page (a range heading cannot say which of
   its members this file is), and where a page carries several headings the one
   agreeing with the filename wins. Requiring a digit after `to` separates all
   274 from the three real titles that begin with the word ("To heirs."), the
   same digit-must-follow rule `citation-linking.md` uses for the period.

2. **`filenameToSectionNumber` does not uppercase chapter letters.**
   `HRS_0039a-0112` → `§39a-112`. Four files exposed it; all four were saved by
   page-sourcing, so the corpus is clean today (0 lowercase `chapterNumber`).
   Latent: any lowercase-letter filename *without* a page heading yields an
   unresolvable number. `normalizeChapterNumber` already handles this correctly —
   only the filename path is wrong.

3. **A source typo, now in our data.** `HRS_0634G-0002.htm` reads `§643G-2`.
   Chapter 643G does not exist. Fixed through the corrections ledger rather than
   the parser — see below.

4. **Stray brackets in titles.** 105 trailing `]` from a fully bracketed heading
   (`[§440G-16 Rules.]` → `"Rules.]"`) — a delimiter artifact, stripped. Distinct
   from 16 cases where the bracket wraps only the *title*
   (`§604-13 [Arrest under warrant.]`), which marks a catchline supplied
   editorially rather than enacted: those are unwrapped and recorded in
   `titleIsSupplied` (13 after re-parse; the other 3 turned out to be partial
   brackets inside the title). The 24 `[OLD]` markers are source text and were
   left alone.

5. **Non-HRS prefix dropped from page-derived numbers.** `HHCA_0501.htm` came
   out as `§501` rather than `HHCA §501`. One file today, latent for all 400
   non-HRS documents.

Three residual bracket cases were inspected and left alone as genuine source
text, not parser artifacts: `[Complaint] in action to enforce lien`, `[NEW]
Definitions.` — editorial substitutions *within* a title rather than brackets
wrapping it — and `Accretion to land. [(a)]`, marking an added subsection.

`isUncodified` at 33.6% looked high but checks out: the sample is all
letter-suffix chapters (431, 201H, 480J, 27G), newer session-law material where
bracketed numbering is genuine.

### `bun run reparse`

Added `src/reparse.ts`, the tool `--save-html` exists to enable: rebuild
`data/parsed` from `data/html` after a parser change, in seconds rather than a
45-minute re-crawl. Pages missing from the cache are fetched and cached, so a
partial cache still yields a complete corpus — which is what filled the 755
gaps left by the original 757-file batch that resume-skipped without saving HTML.

`--dry-run` reports what would change without writing; `--no-fetch` restricts it
to what is already cached. It reports duplicate section numbers the same way the
scraper does, which is how the fixes above were verified.

### Corrections mechanism (implemented)

`src/corrections.ts` + `data/corrections.json`, per `source-anomalies.md`.
Applied after parsing, so `parser.ts` stays a faithful reporter of what the page
says and the editorial layer sits on top of it.

- `§634G-2` is the first and only entry. The corpus now files it correctly,
  `numberSource` reads `correction`, and `sourceAnomalies` carries the observed
  value `§643G-2` with the evidence — so the rendered editorial note is generated
  from the record rather than written by hand. Chapter 634G reads 1/2/3/4 clean.
- **Strict validation, loud failure.** A malformed ledger throws rather than
  risking a silent mis-correction: unknown confidence tier, a conclusive entry
  with nothing to correct to, a flagged entry smuggling in a correction, an
  uncorrectable field, missing evidence, duplicate file+field.
- **Stale entries warn instead of applying.** If `observed` no longer matches the
  source — the parser changed, or the State fixed it upstream — the section is
  left alone and a warning is printed. That is the retirement mechanism open
  question 3 in `source-anomalies.md` asked for.
- `sectionNumberAliases()` exposes `observed -> corrected` for the citation
  resolver, so a citation to `§643G-2` resolves rather than joining the
  unresolved pile. Flagged anomalies produce no alias — there is no target.
- `sourceAnomalies` and the `correction` value on `numberSource` were added in
  the same pass as `covers`/`titleIsSupplied`, before the baseline commit, for
  the same byte-stability reason.

A second `bun run reparse` reports `unchanged 23373  changed 0` — the pipeline is
idempotent.

### Source anomalies policy

`docs/source-anomalies.md` added, prompted by defect 3. The rule: **publish the
statute as published, and say so when it is wrong.** Identity (URL, resolver
index, chapter grouping) is corrected; displayed text stays the source's; a
generated editorial note carries the claim and its evidence. Corrections live in
a reviewed `data/corrections.json`, never inferred at parse time, and that file
doubles as an alias table for the citation resolver. One URL per section — no
redirect from an erroneous number, because that would publish a URL asserting a
section exists when it does not.

## 2026-09-09 — Architecture decided; output made byte-stable

No scraping this session. The 757-section sample from the previous run was used
to settle what the project is actually building, and one blocking change landed
ahead of the full scrape.

### Decision: the product is a static site

The corpus is read-only, public domain, carries no personalization, and changes
on a legislative-session cadence. Nothing a database provides *at runtime* is
something this content needs, so Postgres is out of the architecture:

| Concern | Decision |
|---|---|
| Source of truth | `data/parsed/*.json`, committed |
| Version history | git — a re-scrape diffs to exactly the amended sections |
| Output | ~23,373 statute pages + 1,132 chapter indexes, pre-rendered HTML |
| Search | Pagefind (chunked index; only the search page loads JS) |
| `bodyHtml` | kept as a parse-debugging fallback, never rendered |

Measured for the full corpus: **154 MB** of parsed JSON raw, **~33 MB** gzipped;
`bodyHtml` is 46% of that payload.

`db.ts`, `migrate.ts` and `sql/schema.sql` are kept — `--db` is still useful for
ad-hoc analysis — but they are a side tool now, not the pipeline.

This also resolves the provenance gap raised earlier the same session: git gives
per-section history with real diffs, which is strictly better than the proposed
`section_versions` table, and free. The `scrape_runs` / `content_hash` design in
Known Gaps is superseded for versioning purposes, though `scraped_at` may still
be worth carrying for provenance.

### Byte-stable serialization (blocking; landed)

Git-as-version-store only works if a re-scrape rewrites *only* what changed.
Key order was previously implicit — stable in practice via object-literal
insertion order, but reordering the literal in `parser.ts` would have silently
churned all 24,505 files and made every diff worthless.

- `SECTION_FIELD_ORDER` and `serializeSection()` added to `config.ts`; declared
  key order, two-space indent, trailing newline. `scrape.ts` writes through it.
- A field added to `ParsedSection` but missing from the order list is appended
  rather than dropped from disk silently.
- `bodyHtml` is serialized last — it is the bulk of the payload and none of the
  rendered output, so it stays out of the way in diffs.
- **The existing 757 files were normalized in place.** They were written in the
  old format and the resume logic would have skipped them, leaving a permanently
  mixed-format corpus. Rewritten with a value-identity check on every field: 0
  mismatches, and a re-run now rewrites 0 files.

### `.gitignore`

`data/` was ignored wholesale, which is incompatible with committing the corpus.
Now `data/parsed` and `data/manifest.json` are tracked; `data/html/` and
`data/progress.json` stay ignored — `progress.json` records completion order
from a concurrency pool, so it is nondeterministic by nature.

### Citation linking spec

`docs/citation-linking.md` added: the grammar, and the hazard list, written
before the matcher so the matcher can be tested against it. Profiled from the
sample rather than invented. The three findings that matter:

- **The period is near a coin flip.** On `section \d+[A-Z]?-\d+[A-Z]?\.`, the
  sample splits 34 sentence-ends against 29 real decimals. `section 11-97. A`
  and `section 6E-43.6` are character-identical up to the period. Rule: consume
  `.` only when a digit follows.
- **Not every "section N" is HRS.** `section 203 of the Hawaiian Homes
  Commission Act`, `section 106 of the National Historic Preservation Act` —
  linking those into the HRS namespace produces a confident, wrong, legally
  misleading link.
- **The sample cannot see ~12% of the problem.** It contains zero colon/article
  citations (`§431:1-100`); Volume 1 does not use the form but ~3,000 files
  elsewhere do. Re-profile against the full corpus before trusting any count.

The design principle: **resolve, don't match.** `manifest.json` is a complete
inventory of all 24,505 files, so every candidate can be looked up against the
real set of section numbers. Link what resolves, leave the rest as plain text,
and track the unresolved count as the quality metric — that feedback loop is
what regex-only implementations lack.

Tests pass (39), typecheck clean.

## Verified on 2026-09-08

**Discovery** — full crawl in ~2 minutes:

```
14 volumes, 1114 chapters, 24505 files
```

**Scrape** — 800 files, 0 failures, 0 duplicate section numbers. Of the 357 HRS
sections in that batch, 357 (100%) had their number and title read from the page
rather than inferred from the filename, and none produced an empty body.

**Number derivation** — 89 files sampled across all four filename shapes
(plain, decimal, article, article+decimal); the filename-derived number agreed
with the page text in 87 of 87 cases where the page states one. The other 2 are
article banner pages with no section heading, which correctly fall back.

## Fixed this pass

### 1. Discovery returned nothing

`parseDirectoryListing` dropped every href beginning with `/`, but the IIS
listings link with absolute paths. Every link was filtered out, so the manifest
was `{"volumes": [], "totalFiles": 0}` and nothing downstream could run. Links
are now resolved against the page URL and kept when they land directly inside
it, which also drops the parent-directory link without special-casing it.

### 2. Dropped Puppeteer for the main path

`www.capitol.hawaii.gov` is behind Cloudflare and 403s anything that is not a
real browser. `data.capitol.hawaii.gov` serves the same files with no bot
protection. The fetcher now uses plain `fetch` with a five-worker pool and
global request spacing; Puppeteer is loaded lazily and only as a per-request
fallback. The full scrape drops from roughly eight hours to about 45 minutes,
and the captured HTML is the original source rather than a serialized DOM with
Cloudflare's beacon injected.

(A clearance-cookie shortcut was tested and does not work — Cloudflare binds
`__cf_bm` to the TLS fingerprint, so the cookie is useless outside the browser.)

### 3. Section numbers were wrong for ~3,000 files

The `-` and `_` separators are not interchangeable, but the old parser split on
`[-_]` and lost the distinction. A second hyphen introduces an article and an
underscore introduces a decimal:

| filename | was | now |
|---|---|---|
| `HRS_0431-0001-0100.htm` | `§431-1.100` | `§431:1-100` |
| `HRS_0011-0001_0005_0002.htm` | `§11:1-5.2` | `§11-1.52` |
| `HRS_0663E-0010.docx.htm` | `§663E-10.docx` | `§663E-10` |

Since `section_number` is the upsert key, these collided and silently
overwrote each other. The scraper now also warns on any duplicate.

### 4. `--db` mode would have failed on every insert

`discover.ts` stored chapter numbers as `0001` while the parser derived `1`,
and `sections.chapter_number` has a foreign key to `chapters.number` — so every
section insert would have raised a foreign key violation. Both sides now go
through `normalizeChapterNumber`, and a test asserts they agree.

### 5. Parser rewritten around the document structure

The pages are Word exports with a stable class vocabulary (`RegularParagraphs`,
`XNotesHeading`, `XNotes`), which the old regex approach ignored. Consequences
that are now fixed:

- **Titles.** Word splits headings across several `<b>` elements
  (`<b>§1</b>-<b>2 Title.</b>`), and taking the first bold node yielded an empty
  title. Headings are now assembled from the leading bold runs.
- **History.** The old pattern required `[L <year>`, but prefixes vary
  (`CC`, `RL`, `AC`, `am L`). The year is now the marker. §1-2 previously
  produced an empty history — the README documented that empty value as correct
  output.
- **Annotations.** Headings are open-ended (Case Notes, Attorney General
  Opinions, Law Journals and Reviews, Revision Note, `COMMENTARY ON §701-100`).
  The old hardcoded list dropped most of them, and the Case Notes regex swallowed
  every following section into `caseNotes`. All blocks are now kept as
  `{heading, text}` pairs, with `caseNotes` and `crossReferences` still exposed
  as convenience fields.
- **Section numbers come from the page** where one is stated, with the filename
  as fallback; `numberSource` records which was used.

### 6. Special directories are no longer skipped

The chapter regex `^HRS(\d{4}\w*)$` excluded `01-USCON`, `02-HNP`, `03-ORG`,
`04-ADM`, `05-CONST` and `06-HHCA` — about 424 files including both
constitutions and the Hawaiian Homes Commission Act. Every subdirectory of a
volume is now treated as a chapter, and documents carry a `docType`.

### 7. Chapter titles

Index pages were fetched and thrown away. They are now parsed for the chapter
title, and `chapters.title` was added to the schema (the plan called for it; the
schema never had it).

### 8. Found by the live run

Three cases that only appeared once real pages went through:

- Numbers are often written with a non-breaking hyphen (U+2011), which failed
  the heading match; hyphen variants are now normalized.
- An annotation can precede the section (a PART banner, a Note about the part,
  then the section), which pushed the statute text inside the annotation. A
  statute heading now reopens the body.
- A page can consist solely of a bracketed repeal note, which history stripping
  reduced to an empty body.

## Also changed

- `bun test` suite (39 tests) covering number derivation against real corpus
  filenames, heading extraction, annotation splitting, and index parsing.
- `--concurrency N` flag on the scraper.
- Schema is re-runnable (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- Removed the unused `index.ts` scaffold, the unused `fetchBatch` helper, and
  `ALT_BASE_URL`, which pointed at `capitol.hawaii.gov` — a host that also 403s.
  `MAX_CONCURRENT` and `HEADERS` were dead constants and are now actually used.

## Next Steps

1. ~~**Full scrape**~~ — done 2026-09-09, 0 failures. See above.
2. ~~**Fix the defects and re-parse from local HTML**~~ — done; five parser
   defects fixed, corrections mechanism added, 0 duplicate section numbers.
3. ~~**Commit the corpus**~~ — done, commits `49658a3` (code) and `d6c44db`
   (23,373 sections). This is the baseline every future re-scrape diffs against.
4. ~~**Re-profile citations against the full corpus.**~~ — done 2026-09-09; see
   the session note above and the measured counts in `citation-linking.md`.
5. **Citation linking** — the primary outcome. Suggested order is in
   `citation-linking.md`: resolver first, Cross References annotations as the
   proving ground, then body text.
6. **Static site build**: a Bun step reading `data/parsed` and writing HTML.
   Note the deployment constraint — 24,505 files exceeds Cloudflare Pages'
   20,000-file cap, and other hosts have their own ceilings. Verify current
   limits before choosing one.
7. **Pagefind integration** over the built site.
8. **Non-HRS numbering and titles**: the constitutions, Organic Act, Admission
   Act and HHCA (about 424 files) are captured and tagged, but their numbers are
   prefixed identifiers (`CONST §1-1`) rather than proper citations
   (`Haw. Const. art. I, §1`), and titles are missed for the constitutions,
   where the title sits in centered paragraphs above a `Section n.` heading.
   The Admission and Organic Acts have no titles to find. This now matters more
   than it did — HRS text cites these documents, and linking those citations
   needs real targets. See Known Gaps in `project-plan.md`.
