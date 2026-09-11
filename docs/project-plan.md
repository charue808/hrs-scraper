# HRS Scraper — Architecture & Reference

**Last updated**: 2026-09-10

This was originally the pre-implementation plan. It is now the living design
reference and describes the system as built, with the site facts corrected
against the live server. `progress.md` records what changed and why.

Everything below marked as a count or a structural claim has been verified
against `data.capitol.hawaii.gov`; the few open questions are called out as
such.

---

## Goal

Crawl the Hawaii Revised Statutes and parse them into structured data, then
publish them as a static, accessible, fully cross-linked document set — the
statutes as they are published are flat `.htm` files in which every reference
to another statute is dead text.

The scrape produces a `ParsedSection` per file (number, title, body text,
legislative history, cross references, annotations); citation linking turns the
references into resolved links; the site is pre-rendered from that. See
Storage & Delivery below and `citation-linking.md`.

## Status

The corpus is scraped, parsed, committed, cross-linked and **built into a
static site** with search and backlinks (49,413 files, 0 broken internal links).
**`STATE.md` is the current-state summary** — what is trustworthy, what
is missing, and where the loose threads are. This document is the design
reference underneath it.

Companion documents: `citation-linking.md` (the primary outcome, with all nine
hazards and the measured results) and `source-anomalies.md` (how errors in the
published statutes are recorded and presented).

## Storage & Delivery — decided 2026-09-09

**The product is a static site. Postgres is not part of the architecture.**

The corpus is read-only, public domain, carries no personalization, and changes
on a legislative-session cadence. Nothing a database provides at runtime is
something this content needs. Concretely:

- **Source of truth**: `data/parsed/*.json`, committed to the repo.
- **Version store**: git. A re-scrape after a session diffs to exactly the
  sections that were amended, and `git log` on one file is that section's
  history — which is strictly better than the `section_versions` table proposed
  under Known Gaps, and free. This depends on byte-stable serialization; see
  `SECTION_FIELD_ORDER` in `config.ts`.
- **Output**: 23,373 statute pages + 1,114 chapter pages + 14 volume pages and a
  home page, pre-rendered to plain HTML with citations already resolved to links.
  URLs are extensionless directories (`/hrs/26-34/index.html` serves
  `/hrs/26-34`), which needs no rewrite rules on any static host. No client-side fetching,
  no JS on statute pages — which also means nothing to fail for a screen reader.
- **Search**: Pagefind, wired up 2026-09-10. Indexes the 24,487 statute and
  chapter pages; annotations are weighted at 0.4 and backlinks excluded. Its
  index is chunked, so a query pulls a few hundred KB rather than the whole
  corpus, and only the search page loads any JS.
- **`bodyHtml`**: retained in the parsed JSON as a fallback for debugging parse
  issues, but never rendered. Pages are built from the structured fields, which
  is what gives us control over the markup for accessibility. It is 46% of the
  payload and is serialized last for that reason.

Measured sizes for the full corpus: 154 MB of parsed JSON raw, ~33 MB gzipped.

`db.ts`, `migrate.ts` and `sql/schema.sql` are kept — `--db` remains useful for
ad-hoc analysis during development — but they are a side tool, not the pipeline.

**Deployment**: the build emits **49,413 files** (measured, not estimated) — Pagefind writes one fragment per indexed page and more than doubles the count. Cloudflare raised the Pages
cap to 100,000 for paid plans on 2026-01-23 (requires
`PAGES_WRANGLER_MAJOR_VERSION=4`), and Workers static assets tier the same way,
so a paid plan on either clears it. Both free tiers stop at 20,000. If free
hosting ever becomes a requirement, folding the 1,114 chapter pages into fewer
pages is the cheapest reduction. Limits move — re-check before committing.

---

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **HTML parsing**: cheerio
- **HTTP**: the built-in `fetch`, with Puppeteer as a fallback only
- **Search**: Pagefind 1.5
- **Database** *(side tool)*: Postgres, via the built-in `Bun.SQL`

The original plan specified `postgres.js` and plain `fetch` with browser-like
headers. Bun ships a Postgres client, so `postgres.js` is unnecessary; the
fetch story is covered under Hosts below.

---

## Hosts

| Host | Behavior |
|---|---|
| `data.capitol.hawaii.gov` | Serves the files with no bot protection. **Primary.** |
| `www.capitol.hawaii.gov` | Behind Cloudflare; 403s anything that is not a real browser. |
| `capitol.hawaii.gov` | Also 403s. Not useful as a fallback. |

Both working hosts serve the same content, but `www` returns it through
Cloudflare, so `page.content()` there yields a serialized DOM with an injected
beacon script rather than the original source. The `data` host returns the file
as published, which is both faster and cleaner to parse.

A clearance-cookie shortcut does **not** work: Cloudflare binds `__cf_bm` to the
TLS fingerprint, so a cookie harvested from Puppeteer is rejected when replayed
from `fetch`. If the `data` host is ever unavailable, the only route to `www` is
a real browser, which is why the Puppeteer fallback is kept.

---

## Site Structure

The HRS is hosted as static `.htm` files on an IIS server with directory
listings enabled.

```
/hrscurrent/
├── Vol01_Ch0001-0042F/         ← 14 volumes
│   ├── 01-USCON/               ← non-HRS documents (see below)
│   ├── 02-HNP/
│   ├── 03-ORG/
│   ├── 04-ADM/
│   ├── 05-CONST/
│   ├── 06-HHCA/
│   ├── HRS0001/                ← chapter directories
│   │   ├── HRS_0001-.htm       ← chapter index / TOC page
│   │   ├── HRS_0001-0001.htm   ← §1-1
│   │   └── ...
│   ├── HRS0006D/               ← chapters can have letter suffixes
│   └── ...
├── Vol02_Ch0046-0115/
└── ... through Vol14_Ch0701-0853/
```

Verified totals:

| | |
|---|---|
| Volumes | 14 |
| Chapter directories | 1,114 |
| `.htm` files | 24,505 |
| Chapter index pages | 1,132 |

The listings link with **absolute** paths (`<A HREF="/hrscurrent/Vol01.../">`),
not relative ones. Assuming relative hrefs is what made the first
implementation of discovery return nothing.

### Non-HRS documents

Volume 1 carries six directories that are not numbered HRS chapters:

| Directory | Contents | Files |
|---|---|---|
| `01-USCON` | US Constitution | 69 |
| `02-HNP` | Hawaii National Park | 6 |
| `03-ORG` | Organic Act | 108 |
| `04-ADM` | Admission Act | 23 |
| `05-CONST` | Hawaii Constitution | 173 |
| `06-HHCA` | Hawaiian Homes Commission Act | 45 |

They are discovered and scraped alongside the chapters and tagged with a
`docType`. Their headings differ from the HRS form, so they currently fall back
to filename-derived numbers with no title:

- **Admission and Organic Acts** — `<b>§2.</b>  The State of Hawaii shall...`:
  the number is bold but is followed by a period and then straight into the
  text. These sections genuinely have no titles, so the filename-derived number
  is the right answer; only `numberSource` is misleading.
- **Constitutions** — `<b>Section 4.</b>  No law shall be enacted...`, with the
  title in centered bold paragraphs *above* it (`FREEDOM OF RELIGION, SPEECH,
  PRESS, ASSEMBLY AND PETITION`). Here a real title is being missed.

See Known Gaps.

---

## Filename Grammar

This is the part most worth getting right: **`-` and `_` are not
interchangeable.** A second hyphen introduces an article; an underscore
introduces a decimal; repeated underscores concatenate into one decimal.

Counts below are for `HRS_`-prefixed files only:

| Shape | Count | Example | Section number |
|---|---|---|---|
| `C-S` | 17,420 | `HRS_0001-0002.htm` | `§1-2` |
| `C-A-S` | 2,957 | `HRS_0431-0001-0100.htm` | `§431:1-100` |
| `C-S_D` | 2,317 | `HRS_0001-0004_0005.htm` | `§1-4.5` |
| `C-` | 1,108 | `HRS_0001-.htm` | chapter index |
| `C-A-S_D` | 171 | `HRS_0412-0002-0100_0005.htm` | `§412:2-100.5` |
| `C-S_D_D` | 103 | `HRS_0011-0001_0005_0002.htm` | `§11-1.52` |

Chapter and section components carry leading zeros and may end in letters
(`0431K` → `431K`, `0010A` → `10A`).

Splitting on `[-_]` without tracking which separator appeared loses the
distinction and mis-numbers roughly 3,000 files. Because `section_number` is
the upsert key, those collide silently.

Non-HRS filenames (`CONST_`, `USCON_`, `HHCA_`, `ADM_`, `ORG_`, `HNP_`) have no
chapter/article grammar and are numbered under their prefix: `CONST_0001-0001`
→ `CONST §1-1`, `HHCA_0201_0005` → `HHCA §201.5`.

### Malformed names

Four files in the corpus need special handling:

- `HRS_0663E-0010.docx.htm` and two siblings — a stray `.docx` before `.htm`
- `HRS_0291-0024­_0004.htm` — contains a soft hyphen (U+00AD)
- `HRS_0431-0009A-0101_[OLD].htm` — a superseded copy that would otherwise
  collide with the live `HRS_0431-0009A-0101.htm`; it keeps an ` [OLD]` suffix

---

## HTML Structure

The pages are Word exports ("Microsoft Word 15 (filtered)") with a small,
stable class vocabulary. That vocabulary — not regex scanning of the flattened
text — is what the parser keys on.

| Class | Meaning |
|---|---|
| `WordSection1` | Wrapper div around the document body |
| `RegularParagraphs` | Statute text (also `oneParagraph` on some pages) |
| `XNotesHeading` | Opens an annotation block |
| `XNotes` | Annotation body text |

A typical section page:

```html
<div class="WordSection1">
  <p class="RegularParagraphs"><b>     §1-1  Common law of the State; exceptions.</b>
     The common law of England ... [L 1892, c 57, §5; ... HRS §1-1]</p>
  <p class="XNotesHeading">Attorney General Opinions</p>
  <p class="XNotes">  Common-law authority establishes ... Att. Gen. Op. 92-4.</p>
  <p class="XNotesHeading">Case Notes</p>
  <p class="XNotes">  Generally. ...</p>
</div>
<div id="pageLinks">...</div>   ← navigation chrome, stripped
```

### The bracket convention

**Brackets mark material supplied by the revisor rather than enacted by the
legislature.** This is the single most load-bearing piece of HRS typography, and
it shows up in four places this codebase touches: section headings
(`[§11-1.52]`), catchlines (`§604-13 [Arrest under warrant.]`), PART/ARTICLE
banners (`[PART IV. THE EXECUTIVE BUDGET]`) and numbers cited in running text
(`established in section [226-55]`).

The corpus states it itself, in its own annotations:

- §286C-1, Revision Note — *"Bracketed words ... added by revisor."*
- §321-561, Note — *"Part heading added by revisor pursuant to §23G-15."*
- §712A-4, Commentary — *"Act 18, Session Laws 1999, amended this section by
  **deleting the brackets** around 'trademark counterfeiting,'"* — the
  legislature ratifies revisor-supplied material by removing the brackets.

§23G-15(1) is the statutory authority: the revisor may *"number and renumber
chapters, sections, and parts of sections"*. A bracketed heading is that power
leaving a trace.

**It does not mean "not yet codified."** The code and docs claimed that until
2026-09-10; nothing in the corpus supports it, and **7,859 sections — 33.6% of
the corpus — carry a bracketed heading**, which is far too many to be awaiting
codification when they are printed in the HRS. A hypothesis that bracketed
sections come from acts the revisor split (`pt of §1` in the history) was tested
and **failed**: 79.8% of bracketed versus 70.6% of unbracketed, no real signal.

The scope matters for how this is presented. Only the *heading* is editorial —
the statute's text is enacted law either way, so the rendered label says
"heading supplied by the revisor" and deliberately avoids any phrasing like
"not enacted", which would invite exactly the wrong reading of a legal document.

The field is still called `isUncodified`. Renaming it rewrites all 23,373 files,
so it is a deliberate separate commit rather than a drive-by.

### Section headings

Word splits the heading across several `<b>` elements and leaves the connector
between them unbolded:

```html
<b>     §1</b>-<b>2  Certain laws not obligatory until published.</b>  No written law...
```

Taking the first bold node yields `§1`, which then strips to an empty title.
The parser instead walks the paragraph's text runs from the start, accepting
bold runs and the short unbolded connectors between them, and stopping at the
first real prose run.

Headings appear in several forms:

- `§1-1  Title.` — ordinary
- `[§11-1.52]  Title.` — brackets mark a heading supplied by the revisor
  (`isUncodified`; see The bracket convention below — the field is misnamed)
- `§431:1-100.5  Purpose.` — colon/article notation
- `§11‑3 Application of chapter.` — written with a **non-breaking hyphen**
  (U+2011), which appears throughout the corpus and must be normalized before
  matching. The en dash (U+2013) is prose punctuation and is left alone.

Some pages have no section heading at all — an article banner page whose only
content is `ARTICLE 1`. These fall back to the filename-derived number.

### Annotation headings are open-ended

There is no fixed set. Observed so far: *Case Notes, Attorney General Opinions,
Law Journals and Reviews, Cross References, Revision Note, Note, Rules of
Court, COMMENTARY ON §701-100, SUPPLEMENTAL COMMENTARY ON §701-100*. The Penal
Code commentary is legally significant, so a hardcoded list of headings loses
real content. All blocks are kept as `{heading, text}` pairs; `caseNotes` and
`crossReferences` remain as convenience fields derived from them.

An annotation can also appear **before** the section: a PART banner, a Note
about the part, then the section itself. So an annotation block does not imply
the statute text is finished.

### Legislative history

A bracketed span at the end of the body. The prefix varies — `L`, `RL`, `CC`,
`AC`, `am L` — so the **four-digit year is the reliable marker**, not the `L`.
Requiring `[L <year>` misses sections like §1-2, whose history begins
`[CC 1859, ...]`.

### Chapter index pages

Named with a trailing separator (`HRS_0001-.htm`, `CONST_.htm`). They contain a
`CHAPTER <number>` paragraph followed by the chapter title:

```
CHAPTER 431K
RISK RETENTION
Section
431K-1 Definitions
...
```

Some are preceded by division/title banners and a table of contents for the
whole title, in which a bare `Chapter` column header appears — so the
`CHAPTER <number>` line must be located rather than assumed to be first.

---

## Pipeline

Five steps. The first two touch the network; the rest are local and cheap, which
is what makes iterating on the parser practical.

```
discover  ──> data/manifest.json     crawl the directory listings          ~2 min
scrape    ──> data/parsed/*.json     fetch + parse + cache HTML            ~45 min
              data/html/*.htm
chapters  ──> data/chapters.json     chapter titles + notes from indexes   seconds
reparse   ──> data/parsed/*.json     rebuild from cached HTML              seconds
build     ──> build/site/**          the whole site, citations linked      ~5 s
```

`reparse` is the loop that matters after the initial scrape: change the parser,
rebuild the whole corpus from `data/html` in seconds, and read the diff. It
fetches anything missing from the cache, so a partial cache still produces a
complete corpus.

Citation linking is not a pipeline step — it happens at render time, from
`data/parsed` plus `data/manifest.json` plus `data/corrections.json`.

### Phase 1 — Discovery (`src/discover.ts`)

Three-level crawl of the directory listings: root → volumes → chapters → files.
Hrefs are resolved against the page URL with `new URL()` and kept only when
they land directly inside it, which handles the absolute paths and drops the
`[To Parent Directory]` link without special-casing either.

Every subdirectory of a volume is treated as a chapter, so the non-HRS
directories are included rather than filtered out by a `HRS\d{4}` pattern.

Output: `data/manifest.json` (~5.6 MB). Runs in about 2 minutes.

### Phase 2 — Scrape (`src/scrape.ts`)

Walks the manifest through a concurrency pool. For each file:

- index page → parse the chapter title, update `chapters.title`
- section page → parse, apply `data/corrections.json`, write
  `data/parsed/<name>.json`, and upsert if `--db`

Resume state lives in `data/progress.json` and is written every 100 files.
Duplicate section numbers are reported rather than silently overwritten.

With `--db`, volumes and chapters are upserted up front, since
`sections.chapter_number` has a foreign key to `chapters.number`.

---

## Module Reference

```
src/
  config.ts        types, constants, SECTION_FIELD_ORDER, serializeSection
  fetcher.ts       fetchPage, pool, closeBrowser, NotFoundError

  discover.ts      Phase 1: directory listings -> manifest
  scrape.ts        Phase 2: fetch, parse, store
  reparse.ts       rebuild data/parsed from cached HTML after a parser change
  chapters.ts      chapter titles, notes, annotations -> data/chapters.json

  parser.ts        filenameToSectionNumber, extractChapterFromFilename,
                   normalizeChapterNumber, isIndexFilename,
                   docTypeFromFilename, parseSection, parseChapterIndex
  corrections.ts   loadCorrections, applyCorrections, sectionNumberAliases
  resolver.ts      buildIndex, resolve, sectionSlug/sectionHref/chapterHref
  citations.ts     detect, linkify, expandRange, tally, escapeHtml
  graph.ts         the citation graph: edges, backlinks, citations.json
  vocabulary.ts    corpus word list, for spelling suggestions on /search
  search-client.js browser script for /search: jump-to-section, spelling
  verify-search.ts end-to-end check of /search in a real browser
  site.ts          the site's markup: page shell, section/chapter/volume/search
                   pages, outline depth, part banners, footers, backlinks
  build.ts         reads the corpus, resolves citations, writes build/site
  serve.ts         serves build/site locally (development only)

  profile-citations.ts   the citation quality metric
  test-parse.ts          parse one URL or local file

  parser.test.ts         77 tests
  citations.test.ts      44 tests
  corrections.test.ts    15 tests
  graph.test.ts          10 tests
  vocabulary.test.ts      8 tests
  site.test.ts           49 tests

sql/schema.sql     standalone schema (side tool)
data/              manifest.json, chapters.json, corrections.json and
                   parsed/ are tracked; html/ and progress.json are not
```

### Why the layers split where they do

`parser.ts` is a faithful reporter of what a page says and holds no knowledge of
the corpus as a whole. `corrections.ts` layers reviewed editorial judgment on
top of it. `resolver.ts` owns the inventory. `citations.ts` owns the grammar and
never touches the filesystem. That ordering is what keeps "the source says X" and
"X is wrong" from getting tangled together.

### Fetching

`fetchPage(url)` retries 3 times with exponential backoff against the `data`
host, then falls back to Puppeteer against `www`. Puppeteer is imported lazily,
so the browser never launches unless a request actually fails.

Request starts are spaced `RATE_LIMIT_MS` apart **globally**, not per worker, so
raising `--concurrency` never raises the request rate beyond that spacing.

`pool(items, concurrency, fn)` is the shared worker-pool helper, used by both
phases.

---

## Data Model

### `ParsedSection`

| Field | Notes |
|---|---|
| `sectionNumber` | `§1-2`, `§431:1-100.5`, `CONST §1-1`. Unique; upsert key. |
| `title` | From the page heading |
| `bodyText` | Statute text, heading and history removed |
| `bodyHtml` | The `WordSection1` markup, navigation stripped |
| `history` | Bracketed legislative history |
| `crossReferences` | Entries from the Cross References annotation |
| `caseNotes` | Text of the Case Notes annotation |
| `annotations` | All blocks, as `{heading, text}` |
| `partHeading` | PART/ARTICLE banner above the section, if any |
| `chapterNumber` | Normalized (`1`, `6D`, `431K`, `05-CONST`) |
| `docType` | `hrs`, `const`, `uscon`, `hhca`, `adm`, `org`, `hnp` |
| `isUncodified` | Heading was bracketed, `[§11-1.52]` — revisor-supplied, **not** uncodified. Misnamed; see The bracket convention |
| `isRepealed` | From the title, or a body that is a repeal note |
| `covers` | The span a range page stands for (`§515-10 to 515-12`), else null. 272 sections |
| `titleIsSupplied` | The bracket wrapped only the title — a catchline supplied editorially. 13 sections |
| `sourceAnomalies` | Discrepancies from `data/corrections.json`; `[]` on all but one section |
| `numberSource` | `page`, `filename`, `page-range`, or `correction` |
| `filename`, `url` | Provenance |

Field order is declared in `SECTION_FIELD_ORDER`, not left to object-literal
insertion order. Adding a field appends and is safe; reordering or renaming
rewrites all 23,373 files, so it belongs in its own commit — and adding an
always-present field after the corpus is committed churns everything and buries
the first real amendment diff.

### `ParsedChapterIndex`

What a chapter index page yields, beyond the sections it lists.

| Field | Notes |
|---|---|
| `chapterNumber` | Normalized |
| `title` | From the `CHAPTER n` banner or the paragraph below it |
| `notes` | Chapter-level prose between the banner and the listing — in practice a repeal note. 371 chapters |
| `annotations` | The chapter's *own* annotation blocks. 629 chapters |
| `filename`, `url` | Provenance |

`notes` and `annotations` are scoped to what follows the **live** `CHAPTER n`
banner, and that scoping is what makes them attributable. An index page often
opens with a division/title table of contents carrying its own Cross References
(`HRS_0091-.htm` has one belonging to TITLE 8), and a superseded `[OLD]` banner
brings its own repeal note and cross references with it (`HRS_0431-.htm`).
Both precede the live banner and belong to something other than this chapter.

This matters most for the **293 chapters with no sections at all** — every
section repealed, so nothing in `data/parsed` carries their number. Their index
page is the only thing that says what happened, and none of the 293 has a
section listing. Without `notes` those chapter pages would render blank.

They are written into `data/chapters.json` as `ChapterRecord`, and omitted
rather than written empty: most chapters have neither, and that file is
committed and read as a diff.

### Database

Three tables: `volumes`, `chapters`, `sections`.

Chapter numbers are stored **without leading zeros** so that
`sections.chapter_number` joins `chapters.number`. Storing `0001` on one side
and deriving `1` on the other makes every section insert fail the foreign key.

`sections` carries a generated `fts` tsvector (title weight `A`, body weight
`B`) with a GIN index, plus:

- `search_statutes(query, limit, offset)` — ranked results with
  `<mark>`-highlighted `ts_headline` snippets
- `get_chapter_sections(chapter)` — all sections in a chapter
- `updated_at` triggers on all three tables

`annotations` is JSONB. The schema uses `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` alongside the `CREATE TABLE IF NOT EXISTS` statements so migrations stay
re-runnable against a database created by an earlier version.

`Bun.SQL`'s `.unsafe()` accepts multiple statements as long as no parameters are
bound, which is how `migrate.ts` applies the whole file at once.

---

## Configuration

`.env`:

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

Bun loads `.env` automatically — no `dotenv`.

Tunables in `config.ts`:

| Constant | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_MS` | 120 | Minimum global spacing between request starts |
| `MAX_CONCURRENT` | 5 | Default workers (`--concurrency` overrides) |
| `MAX_RETRIES` | 3 | Attempts before the browser fallback |
| `RETRY_BACKOFF_MS` | 1000 | Base backoff, doubled per attempt |
| `REQUEST_TIMEOUT_MS` | 30000 | Per-request timeout |

---

## Usage

```bash
bun install
bun test

bun run discover                      # crawl -> data/manifest.json (~2 min)
bun run scrape --limit 20 --save-html  # smoke test
bun run scrape --save-html            # full run (~45 min)

bun run reparse                       # rebuild data/parsed from data/html (seconds)
bun run reparse -- --dry-run          # report changes, write nothing
bun run chapters                      # chapter titles + notes -> data/chapters.json
bun run profile-citations             # citation quality metric
bun run build                         # the whole site -> build/site/ (~5s)
bun run build -- --chapter 26         # one chapter, for reviewing by eye
bun run serve                         # browse build/site at localhost:3000
bun run verify-search                 # drive /search in a real browser

# Parse a single page to sanity-check the parser
bun run test-parse -- --file data/html/HRS_0001-0001.htm --json
```

Scraper flags: `--save-html`, `--limit N`, `--concurrency N`, `--db`.
`bun run migrate` and `--db` are the optional Postgres side tool.

---

## Edge Cases Handled

- **Absolute hrefs** in the IIS listings
- **Cloudflare** on `www` — avoided by using the `data` host
- **Article vs decimal** numbering from the filename separator
- **Letter-suffixed chapters** (`6D`, `6E`, `431K`, `10H`)
- **Non-breaking hyphens** (U+2011) inside section numbers
- **Split bold headings** across multiple `<b>` elements
- **History prefixes** other than `L` (`CC`, `RL`, `AC`, `am L`)
- **Annotations before the section**, not only after it
- **Repealed sections**, including bodies that are only a bracketed repeal note
- **Bracketed headings, banners and numbers** — the revisor convention, applied
  to section headings, PART/ARTICLE banners and numbers cited in running text
- **Special directories** with their own filename prefixes
- **Malformed filenames** (`.docx.htm`, soft hyphen, `_[OLD]`)
- **Duplicate section numbers** — reported rather than silently overwritten
- **Range headings** (`§515-10 to 515-12 REPEALED.`) — 274 pages standing for a
  span; the number comes from the filename and the span is recorded in `covers`
- **Subsection markers in headings** — `<b>§26-12 Title. </b>(a)<b> </b>Text`,
  including the variant split across `(`, `a`, `)` runs
- **Bracketed titles** — `[§440G-16 Rules.]` (whole heading) versus
  `§604-13 [Arrest under warrant.]` (catchline supplied editorially)
- **`[OLD]` / `[NEW]` banners** preceding live content, in both section pages
  and chapter index pages
- **Bracketed chapter banners** — `[CHAPTER 30]`, and `[CHAPTER 56 TITLE]` with
  the title inside the bracket
- **Chapter titles beginning with a digit** — "911 SERVICES"
- **Errors in the source itself** — a reviewed correction ledger, never inferred

---

## Known Gaps & Future Work

Ordered by what stands between the current state and a finished site.
`STATE.md` carries the same list in short form alongside the loose threads.

### The correctness gap

- **Non-HRS numbering and titles — 424 files.** The constitutions, Organic Act,
  Admission Act and HHCA are captured and tagged, but numbered as prefixed
  identifiers (`CONST §1-1`) rather than proper citations
  (`Haw. Const. art. I, §1`). Titles are missed for the constitutions, where the
  title sits in centered paragraphs above a `Section n.` heading; the Admission
  and Organic Acts have no titles to find.

  This is no longer optional. HRS text names these documents **306 times** and
  none of those citations can be linked. The resolver deliberately keeps the two
  namespaces apart — 89 non-HRS numbers collide outright with HRS numbers and
  149 are bare — so merging them without a real mapping is how `section 2`
  acquires a confident link to the Admission Act. Deferred until the site build
  is done; see open question 4 in `citation-linking.md`.

### To build

- ~~**The site build.**~~ Done 2026-09-10: `bun run build` emits 24,503 pages
  (23,373 sections, 1,114 chapters, 14 volumes, home, search) with 0 broken
  internal links. `src/site.ts` owns the markup, `src/build.ts` the driver.
- ~~**Pagefind.**~~ Done 2026-09-10. Indexes the 24,487 statute and chapter
  pages; annotations weighted 0.4, backlinks excluded, navigation pages left
  out. Adds 24,907 files.
- ~~**`citations.json`.**~~ Done 2026-09-10: `src/graph.ts`, 28,547 edges,
  rendered as "Cited by" and emitted as a 6.0 MB byte-stable artifact.


### Smaller

- **36 sections have an empty `bodyText`.** Never triaged. Probably banner or
  repeal-note pages, but unconfirmed.
- **Chapter index section listings.** The title, chapter-level notes and
  chapter-level annotations are now extracted (`ParsedChapterIndex`); the
  *listing* still is not. It would make a good coverage check against the files
  actually discovered. It is not needed for a chapter page's contents — those
  are derived from the parsed sections, which carry real titles.
- **Division/Title navigation.** The site navigates by volume, which is a
  printing artifact of the published edition. The index pages carry the real
  hierarchy (`DIVISION 1. GOVERNMENT`, `TITLE 1. GENERAL PROVISIONS`) above the
  chapter banner, and it is not extracted.
- **Historical versions.** `hrsarchive/` holds yearly snapshots from 1999
  onward, but it exists on **`www` only** — the `data` mirror returns 500 for
  that path — so crawling it would need the Puppeteer path throughout. Probably
  not worth it.
- **`fts` excludes annotations** in the Postgres side tool. Case notes and
  commentary are not searchable through `search_statutes()`. Deliberate, and
  irrelevant to the static site, which will index everything through Pagefind.

### Superseded

- ~~**No provenance or version history.**~~ Resolved by the 2026-09-09 storage
  decision: `data/parsed` is committed and git is the version store, so a
  re-scrape diffs to exactly the amended sections and `git log` on one file is
  that section's history. That is strictly better than the `section_versions`
  table this section used to propose, and free. It depends on byte-stable
  serialization — see `SECTION_FIELD_ORDER`.

  One nuance the old design got right and is worth restating: a citation graph is
  only trustworthy if the nodes it points at are pinned to a known version of the
  text. Git provides that pinning by commit, which is why the graph is built at
  render time from the committed corpus rather than accumulated across runs.

  Deliberately **not** carried: a per-section `scraped_at`. It would rewrite all
  23,373 files on every run and destroy the diff property the whole architecture
  rests on. Run-level provenance belongs in a separate file if it is ever needed.
- ~~**Storage.**~~ Measured for real: 154 MB of parsed JSON, ~33 MB gzipped,
  32 MB in git. `bodyHtml` is 46% of it, retained for parse debugging and never
  rendered.
