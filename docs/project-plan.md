# HRS Scraper — Architecture & Reference

**Last updated**: 2026-09-08

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

Discovery and parsing are verified end to end against the live site, and the
full corpus was scraped on 2026-09-09 with zero failures — 24,505 files,
23,373 sections. Four small parser defects found in QA are fixed before the
baseline corpus commit; see the Next Steps in `progress.md`.

Companion documents: `citation-linking.md` (the primary outcome) and
`source-anomalies.md` (how errors in the published statutes are recorded and
presented).

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
- **Output**: ~23,373 statute pages + 1,132 chapter indexes, pre-rendered to
  plain HTML with citations already resolved to links. No client-side fetching,
  no JS on statute pages — which also means nothing to fail for a screen reader.
- **Search**: Pagefind. Its index is chunked, so a query pulls a few hundred KB
  rather than the whole corpus, and only the search page loads any JS.
- **`bodyHtml`**: retained in the parsed JSON as a fallback for debugging parse
  issues, but never rendered. Pages are built from the structured fields, which
  is what gives us control over the markup for accessibility. It is 46% of the
  payload and is serialized last for that reason.

Measured sizes for the full corpus: 154 MB of parsed JSON raw, ~33 MB gzipped.

`db.ts`, `migrate.ts` and `sql/schema.sql` are kept — `--db` remains useful for
ad-hoc analysis during development — but they are a side tool, not the pipeline.

**Deployment constraint**: 24,505 files exceeds Cloudflare Pages' 20,000-file
per-deployment cap, and other static hosts have their own ceilings. Verify the
current limits before choosing a host; Workers static assets, a VPS, or folding
the chapter indexes into fewer pages are the ways out.

---

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **HTML parsing**: cheerio
- **HTTP**: the built-in `fetch`, with Puppeteer as a fallback only
- **Database**: Postgres (Neon), via the built-in `Bun.SQL`

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
- `[§11-1.52]  Title.` — brackets mark a section not yet codified
  (`isUncodified`)
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
- section page → parse, write `data/parsed/<name>.json`, and upsert if `--db`

Resume state lives in `data/progress.json` and is written every 100 files.
Duplicate section numbers are reported rather than silently overwritten.

With `--db`, volumes and chapters are upserted up front, since
`sections.chapter_number` has a foreign key to `chapters.number`.

---

## Module Reference

```
src/
  config.ts        types, constants, env
  fetcher.ts       fetchPage, pool, closeBrowser, NotFoundError
  discover.ts      Phase 1
  scrape.ts        Phase 2
  parser.ts        filenameToSectionNumber, extractChapterFromFilename,
                   normalizeChapterNumber, isIndexFilename,
                   docTypeFromFilename, parseSection, parseChapterIndex
  parser.test.ts   39 tests (bun test)
  db.ts            getDb, closeDb, upsertVolume, upsertChapter,
                   updateChapterTitle, upsertSection
  migrate.ts       runs sql/schema.sql, or prints it if no DATABASE_URL
  test-parse.ts    parse one URL or local file
sql/
  schema.sql       standalone schema
data/              gitignored runtime data
```

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
| `isUncodified` | Heading was bracketed |
| `isRepealed` | From the title, or a body that is a repeal note |
| `numberSource` | `page` or `filename` — how the number was obtained |
| `filename`, `url` | Provenance |

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

# Parse a single page to sanity-check the parser
bun run test-parse -- --url "https://data.capitol.hawaii.gov/hrscurrent/Vol01_Ch0001-0042F/HRS0001/HRS_0001-0001.htm" --json

bun run discover                      # Phase 1 → data/manifest.json (~2 min)
bun run scrape -- --limit 20          # smoke test
bun run migrate                       # schema (prints SQL if no DATABASE_URL)
bun run scrape -- --db                # full run (~45 min)

bun test
```

Scraper flags: `--db`, `--limit N`, `--save-html`, `--concurrency N`.

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
- **Uncodified sections** marked with bracketed headings
- **Special directories** with their own filename prefixes
- **Malformed filenames** (`.docx.htm`, soft hyphen, `_[OLD]`)
- **Duplicate section numbers** — reported rather than silently overwritten

---

## Known Gaps & Future Work

- **Errors in the source documents.** The published HRS contains typographical
  errors — `HRS_0634G-0002.htm` is headed `§643G-2` for a chapter that does not
  exist. Policy, data model and rendering rules are in `source-anomalies.md`:
  identity is corrected so navigation works, displayed text stays faithful to
  the source, and a generated editorial note carries the claim and its evidence.
  Corrections live in a reviewed `data/corrections.json` rather than being
  inferred at parse time.
- **Non-HRS numbering and titles.** The constitutions, Organic Act, Admission
  Act and HHCA are captured and tagged, but numbered as prefixed identifiers
  (`CONST §1-1`) rather than proper citations (`Haw. Const. art. I, §1`).
  Titles are missed for the constitutions, where the title sits in centered
  paragraphs above a `Section n.` heading; the Admission and Organic Acts have
  no titles to find. Worth doing if those documents matter downstream — it is
  about 424 files.
- **Chapter index contents.** Only the chapter title is extracted. The section
  listing on each index page would make a good coverage check against the files
  actually discovered.
- **Historical versions.** `hrsarchive/` holds yearly snapshots from 1999
  onward, but it exists on **`www` only** — the `data` mirror returns 500 for
  that path — so crawling it would need the Puppeteer path throughout.
- **Storage.** Measured on a 757-file sample: roughly 150 MB of local JSON and
  about 90 MB of text in the database for the full corpus, most of it
  `body_html`. Dropping `body_html`, or not writing local JSON during a `--db`
  run, would cut that substantially if it matters.
- **`fts` excludes annotations.** Case notes and commentary are not searchable
  through `search_statutes()`. Deliberate for now — statute text ranks more
  cleanly on its own — but easy to add as a `C`-weighted component.
- **No provenance or version history.** Nothing records *when* a section was
  fetched or whether its text changed between runs. `section_number` is the
  upsert key and every write is `ON CONFLICT DO UPDATE`, so a re-scrape
  overwrites in place and the previous text is gone. The HRS is amended every
  legislative session, which makes this a question of when, not if.

  This matters more for the linked-document outcome than it would for a
  one-off dataset: a citation graph is only trustworthy if the nodes it points
  at are pinned to a known version of the text. "§X-Y links to §Z-W" is a claim
  about a *moment* in the corpus.

  The minimum worth adding before the full `--db` run, since retrofitting
  history onto an upsert-in-place table is materially worse than designing for
  it now:

  - `scraped_at` and `source_etag` / `content_hash` on `sections` — a hash of
    the parsed body is enough to answer "did this change?" without diffing text
  - a `scrape_runs` table (run id, started/finished, file counts, failures) and
    a `run_id` on each section, so any row can be traced to the run that wrote it
  - decide the retention model: either a `section_versions` history table
    written on hash change, or accept snapshot-only and record it as a
    deliberate limitation rather than an accident

  Open question: whether history should ever be reconstructed backwards from
  `hrsarchive/` (yearly snapshots from 1999), which is `www`-only and would
  need the Puppeteer path throughout. Probably not worth it, but the schema
  should not preclude it.
