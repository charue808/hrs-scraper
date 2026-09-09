# HRS Scraper - Implementation Progress

**Last updated**: 2026-09-09

## Status: Ready for the full scrape

Discovery produces a complete manifest, the scraper runs clean, and the output
format is now byte-stable. Remaining work is the full scrape, then citation
linking.

The destination changed on 2026-09-09: the product is a **static site**, not a
Postgres database. See the session note below and Storage & Delivery in
`project-plan.md`.

This document records what changed and why. `project-plan.md` is the design
reference for the system as built.

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

1. **Full scrape**: `bun run scrape` (~45 min; resumes from the 757 already done).
   Two calls to make first:
   - `--save-html` is worth it for this run. 24,505 requests against a
     government server; if a parse bug surfaces later, the raw HTML locally is
     the difference between a 5-second re-parse and another 45-minute crawl.
     ~500 MB, gitignored, disposable.
   - The 757 completed files carry the parse as it stood when they were written
     and will not be re-fetched. Delete `data/progress.json` to redo them if any
     parser change since then should apply.
2. **Commit the corpus** once the scrape completes — this is the baseline
   snapshot that every future re-scrape diffs against.
3. **Re-profile citations against the full corpus.** Every count in
   `citation-linking.md` comes from a Volume-1-heavy sample. Revisit before
   building the matcher.
4. **Citation linking** — the primary outcome. Suggested order is in
   `citation-linking.md`: resolver first, Cross References annotations as the
   proving ground, then body text.
5. **Static site build**: a Bun step reading `data/parsed` and writing HTML.
   Note the deployment constraint — 24,505 files exceeds Cloudflare Pages'
   20,000-file cap, and other hosts have their own ceilings. Verify current
   limits before choosing one.
6. **Pagefind integration** over the built site.
7. **Non-HRS numbering and titles**: the constitutions, Organic Act, Admission
   Act and HHCA (about 424 files) are captured and tagged, but their numbers are
   prefixed identifiers (`CONST §1-1`) rather than proper citations
   (`Haw. Const. art. I, §1`), and titles are missed for the constitutions,
   where the title sits in centered paragraphs above a `Section n.` heading.
   The Admission and Organic Acts have no titles to find. This now matters more
   than it did — HRS text cites these documents, and linking those citations
   needs real targets. See Known Gaps in `project-plan.md`.
