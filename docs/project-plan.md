# Hawaii Revised Statutes Scraper — Implementation Plan

## Goal

Build a Bun-based scraper that crawls the Hawaii Revised Statutes from `https://www.capitol.hawaii.gov/hrscurrent/`, parses the HTML into structured data, and stores everything in a Neon Postgres database with full-text search.

The end result is a `sections` table containing every statute section with its number, title, body text, legislative history, cross-references, case notes, and a GIN-indexed tsvector column for fast full-text search.

---

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **HTML parsing**: cheerio
- **Database**: Neon (serverless Postgres)
- **DB client**: postgres (postgres.js — https://github.com/porsager/postgres)

---

## Site Structure

The HRS is hosted as static `.htm` files on an IIS server with directory listings enabled. The hierarchy is:

```
/hrscurrent/
├── Vol01_Ch0001-0042F/         ← 14 volumes
│   ├── 01-USCON/               ← special dirs (US Constitution, HI Constitution, etc.)
│   ├── 05-CONST/
│   ├── 06-HHCA/
│   ├── HRS0001/                ← chapter directories
│   │   ├── HRS_0001-.htm       ← chapter index/TOC page
│   │   ├── HRS_0001-0001.htm   ← individual section (§1-1)
│   │   ├── HRS_0001-0002.htm   ← §1-2
│   │   └── ...
│   ├── HRS0006D/               ← chapters can have letter suffixes
│   ├── HRS0006E/
│   └── ...
├── Vol02_Ch0046-0115/
├── ...
└── Vol14_Ch0701-0853/
```

Key naming conventions:
- Volume dirs: `Vol{NN}_Ch{NNNN}-{NNNN}{letter?}` — e.g., `Vol01_Ch0001-0042F`
- Chapter dirs: `HRS{NNNN}{letter?}` — e.g., `HRS0001`, `HRS0006D`, `HRS0291`
- Section files: `HRS_{chapter}-{section}.htm` — e.g., `HRS_0001-0001.htm`
- Subsection files: `HRS_{chapter}-{section}_{subsection}.htm` — e.g., `HRS_0291-0003_0001.htm`
- Chapter index files: `HRS_{chapter}-.htm` (note the trailing dash before `.htm`)
- Special dirs: `01-USCON`, `02-HNP`, `03-ORG`, `04-ADM`, `05-CONST`, `06-HHCA`

Section number derivation from filenames:
- `HRS_0001-0001.htm` → `§1-1`
- `HRS_0291-0003_0001.htm` → `§291-3.1`
- `HRS_0006D-0001.htm` → `§6D-1`

The alternate domain `https://data.capitol.hawaii.gov/hrscurrent/` mirrors the same content and may have different rate-limiting behavior. Use it as a fallback if the primary returns 403s.

---

## HTML Content Structure

Each section `.htm` file contains statute text in this general structure (based on observed content — **verify by viewing page source in a browser on one of the section pages**):

```
[Optional: PART heading]

§{number} Title of section. Body text of the statute, which may
include multiple paragraphs, numbered lists (1), (2), (3),
lettered sublists (A), (B), and definitions.

[L YYYY, c NNN, §N; am L YYYY, c NNN, §N; ...]   ← legislative history in brackets

Cross References
  §XXX-YY, Description of related section.
  Chapter NNN, Description.

Case Notes
  Summary of court decisions referencing this section.
  Case name, XX Haw. NNN (YYYY).

Law Journals and Reviews
  Article title. NN HBJ NN.
```

Chapter index pages (`HRS_{chapter}-.htm`) contain:
- Division and title headings
- Chapter title
- Table of contents listing all sections in the chapter

---

## Project Structure

```
hrs-scraper/
├── package.json
├── .env                 ← DATABASE_URL (Neon connection string)
├── .gitignore
├── README.md
├── src/
│   ├── config.ts        ← types, constants, env vars
│   ├── db.ts            ← postgres.js connection, upsert helpers, cleanup
│   ├── fetcher.ts       ← rate-limited HTTP fetch with retries and concurrency control
│   ├── parser.ts        ← HTML→structured data parsing
│   ├── discover.ts      ← Phase 1: crawl directory listings → manifest.json
│   ├── scrape.ts        ← Phase 2: fetch, parse, store (with resume support)
│   ├── migrate.ts       ← generate and/or run database schema
│   └── test-parse.ts    ← test parser against a single URL or local file
├── sql/
│   └── schema.sql       ← standalone SQL for Neon SQL Editor or psql
└── data/                ← gitignored runtime data
    ├── manifest.json    ← output of Phase 1
    ├── progress.json    ← scrape resume state
    ├── raw-html/        ← optional raw HTML cache
    └── parsed/          ← parsed JSON files (local mode)
```

---

## Implementation Steps

### Step 1: Project Setup

Initialize a Bun project with these dependencies:
- `cheerio` (HTML parsing)
- `postgres` (postgres.js — lightweight Postgres client, works great with Bun and Neon)

Create `src/config.ts` with:
- TypeScript interfaces: `Volume`, `Chapter`, `SectionFile`, `ParsedSection`, `Manifest`
- Constants: `BASE_URL`, `ALT_BASE_URL`, `HEADERS` (browser-like User-Agent), rate-limit settings
- File paths for data directories
- `DATABASE_URL` from env vars

### Step 2: HTTP Fetcher (`src/fetcher.ts`)

Build a `fetchPage(url)` function with:
- **Rate limiting**: minimum 350ms between requests
- **Concurrency control**: max 2 parallel requests
- **Retries**: 3 attempts with exponential backoff (2s, 4s, 6s)
- **Browser-like headers**: realistic User-Agent, Accept, Accept-Language
- **Error handling**: special messages for 403 (suggest ALT_BASE_URL) and 404

Also provide a `fetchBatch(urls[])` for batch operations with progress callbacks.

### Step 3: Phase 1 — Discovery (`src/discover.ts`)

Crawl the IIS directory listings to build a complete URL manifest.

The IIS directory listing pages are HTML with `<a>` tags for each file/directory entry. Parse them to extract directory names and filenames. The text may also appear in `<pre>` blocks with patterns like `<dir> DirectoryName` and `12345 FileName.htm`.

Three-level crawl:
1. Fetch `/hrscurrent/` → extract volume directory names matching `Vol{NN}_Ch{...}`
2. For each volume, fetch its listing → extract chapter dirs matching `HRS{NNNN}{letter?}` and special dirs like `05-CONST`
3. For each chapter, fetch its listing → collect all `.htm` filenames

Identify chapter index pages by the pattern `HRS_{chapter}-.htm` (trailing dash).

Output: save `data/manifest.json` with all volumes, chapters, section files, and stats.

### Step 4: HTML Parser (`src/parser.ts`)

Parse individual section `.htm` files into structured `ParsedSection` objects.

Key extraction logic:

**Section number and title**: Match `§{number} Title.` or `[§{number}] Title.` (brackets indicate new sections). Fall back to deriving from the filename if the regex doesn't match.

**Filename to section number**: `HRS_0291-0003_0001.htm` → strip `HRS_` and `.htm`, parse `0291-0003_0001` as chapter `291`, section `3`, subsection `.1` → `291-3.1`. Handle letter suffixes in chapter numbers.

**Legislative history**: Extract text in brackets matching `[L YYYY, c NNN, §N; ...]` — the `L` followed by a year is the reliable marker.

**Body text**: Everything between the title and the legislative history, excluding cross references, case notes, and law journal sections.

**Cross references**: Text after "Cross References" heading, extract `§{number}` patterns.

**Case notes**: Text after "Case Notes" heading until "Law Journals" or end of document.

**Part heading**: Match `PART {roman numeral}. {TITLE}` at the start of text.

**Chapter index pages**: Extract chapter title (after `CHAPTER {number}`) and section listings.

IMPORTANT: The parser patterns need verification against actual HTML source. Include a `test-parse.ts` utility that can fetch a single URL or read a local `.htm` file and print all extracted fields for validation.

### Step 5: Phase 2 — Scrape (`src/scrape.ts`)

Iterate through the manifest, fetch each page, parse it, and store results.

**Resume support**: Track completed URLs in `data/progress.json`. On restart, skip already-completed URLs. Save progress every 100 sections.

**Two output modes**:
- **Local mode** (default): Save parsed JSON files to `data/parsed/`
- **Database mode** (`--db` flag): Upsert into Neon Postgres using the `section_number` as the conflict key

For database mode, create a `src/db.ts` module that:
- Initializes a `postgres` connection using `DATABASE_URL`
- Provides an `upsertSection(section)` function that runs `INSERT ... ON CONFLICT (section_number) DO UPDATE`
- Provides an `upsertChapter(chapter)` function similarly
- Handles connection cleanup with `sql.end()` on process exit

**CLI flags**:
- `--db` — enable Neon Postgres insertion
- `--limit N` — only process N sections (for testing)
- `--save-html` — also save raw HTML files to `data/raw-html/`

Show progress as a percentage with the current filename.

### Step 6: Database Schema (`sql/schema.sql` and `src/migrate.ts`)

Create three tables:

**`volumes`**: `id`, `volume_number` (unique), `chapter_range`, `directory_name` (unique)

**`chapters`**: `id`, `chapter_number` (unique, TEXT to handle "6D", "6E"), `volume_number`, `title`, `directory_name` (unique), `volume_directory_name`

**`sections`**: `id`, `section_number` (unique, TEXT), `chapter_number`, `volume_number`, `title`, `body_text`, `body_html`, `legislative_history`, `cross_references` (TEXT[]), `case_notes`, `part_heading`, `source_url`, `filename`, `scraped_at`, `updated_at`

**Full-text search**: Add a generated `fts` tsvector column with weighted components — title as weight 'A', body_text as weight 'B'. Create a GIN index on it.

**Search function**: `search_statutes(query TEXT, limit INT, offset INT)` that returns section_number, chapter_number, title, a `ts_headline` snippet with `<mark>` tags, and a rank score.

**Helper function**: `get_chapter_sections(chapter TEXT)` that returns all sections in a chapter, ordered by section number.

**Auto-update trigger**: `updated_at` column auto-updates on row changes.

The `migrate.ts` script should:
- If `DATABASE_URL` is configured, connect via `postgres` and execute the schema SQL directly (postgres.js supports raw DDL execution via tagged template literals or `.unsafe()`)
- Always save the SQL to `sql/schema.sql`
- Print the SQL to stdout if no credentials are set

Example connection and migration pattern with postgres.js:
```ts
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);
await sql.unsafe(schemaSql);
await sql.end();
```

---

## Configuration

Environment variables (`.env`):
```
DATABASE_URL=postgresql://user:password@ep-xxx-yyy-zzz.us-east-2.aws.neon.tech/dbname?sslmode=require
```

You can find this connection string in the Neon dashboard under your project's "Connection Details" tab. Make sure to use the pooled connection string for production workloads, and include `?sslmode=require` (Neon requires SSL).

Tunable constants in `config.ts`:
- `DELAY_MS = 350` — ms between requests
- `MAX_CONCURRENCY = 2` — parallel fetches
- `MAX_RETRIES = 3` — retry attempts
- `RETRY_DELAY_MS = 2000` — base retry delay (multiplied by attempt number)

---

## Usage Workflow

```bash
# 1. Install deps
bun install

# 2. Test parser on a single page (do this first to verify/refine parsing)
bun run test-parse -- --url "https://www.capitol.hawaii.gov/hrscurrent/Vol01_Ch0001-0042F/HRS0001/HRS_0001-0001.htm" --save

# 3. Build the manifest
bun run discover

# 4. Test with a small batch
bun run scrape -- --limit 20 --save-html

# 5. Set up the database
#    Option A: run migrate.ts with DATABASE_URL set
bun run migrate
#    Option B: paste sql/schema.sql into the Neon SQL Editor

# 6. Full scrape with DB insertion
bun run scrape -- --db
```

---

## Edge Cases to Handle

- **403 Forbidden**: The server may block automated requests. Use browser-like headers and fall back to `data.capitol.hawaii.gov`.
- **Repealed sections**: Some sections are repealed and may have different text patterns (e.g., just "[Repealed.]" with legislative history).
- **Letter-suffixed chapters**: Chapters like `6D`, `6E`, `6K`, `10H` are legitimate and common.
- **Subsection numbering**: Files like `HRS_0291-0003_0001.htm` represent subsections (§291-3.1).
- **Special directories**: `01-USCON` (US Constitution), `05-CONST` (HI Constitution), `06-HHCA` (Hawaiian Homes Commission Act) have different content structures than regular HRS sections.
- **Empty or minimal pages**: Some pages may have very little content. The parser should return null gracefully.
- **Encoding**: The `.htm` files may use Windows-1252 or similar encoding. Handle non-UTF8 characters.
- **Colon notation**: Some section numbers use colons (e.g., `§431:10A-601`). The parser needs to handle this.

---

## Notes

- HRS content is public domain (government works) — no copyright concerns with scraping.
- The full scrape is estimated at 10,000+ files and will take several hours at the configured rate limits.
- The `hrsarchive/` directory on the same server contains historical versions from 1999–2017 if we want version history later.
- The `search_statutes()` Postgres function returns `<mark>`-wrapped snippets ready for front-end display.
- Neon's free tier includes 0.5 GB of storage which should comfortably hold the full HRS dataset. The branching feature is useful for testing schema changes without affecting production data.
