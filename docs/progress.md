# HRS Scraper - Implementation Progress

**Last updated**: 2026-09-09

## Status: Corpus scraped, parsed clean, corrections applied; ready for the baseline commit

The full scrape completed with zero failures. QA surfaced five parser defects
and one genuine error in the published source; all six are resolved and the
corpus re-parsed — 23,373 sections, no duplicate section numbers, 69 tests.

Next: commit the baseline corpus, then re-profile citations against it.

The destination changed on 2026-09-09: the product is a **static site**, not a
Postgres database. See the session note below and Storage & Delivery in
`project-plan.md`.

This document records what changed and why. `project-plan.md` is the design
reference for the system as built.

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
2. **Fix the four defects and re-parse from local HTML**, before committing the
   corpus. Three of them change section numbers, and the baseline commit is what
   every future amendment diff is measured against — number churn in that diff
   would be indistinguishable from a real legislative change. Add
   `sourceAnomalies` to `ParsedSection` in the same pass, for the same reason:
   an always-present field costs nothing to add while the corpus is uncommitted
   and rewrites all 23,373 files if added later.
3. **Commit the corpus** — the baseline snapshot every future re-scrape diffs
   against.
4. **Re-profile citations against the full corpus.** Every count in
   `citation-linking.md` comes from a Volume-1-heavy sample. Revisit before
   building the matcher.
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
