# hrs-scraper

A TypeScript scraper that crawls the [Hawaii Revised Statutes](https://www.capitol.hawaii.gov/hrscurrent/), parses ~24,500 statute files from raw HTML into structured data, and stores them in PostgreSQL with full-text search.

## Motivation

The Hawaii Revised Statutes are publicly available but only as individual `.htm` files on an IIS directory server with no API or search functionality. This tool extracts the full corpus into a structured, searchable database — making it possible to build legal research tools, search interfaces, or datasets on top of the statutes.

## Key Technical Decisions

- **The `data.capitol.hawaii.gov` mirror** — `www.capitol.hawaii.gov` sits behind Cloudflare and returns 403 to anything that is not a real browser. The `data` host serves byte-identical files with no bot protection, so ordinary `fetch` works and the scrape runs with real concurrency. Puppeteer is kept only as a per-request fallback and is never launched on the happy path.
- **The filename separator carries meaning** — `-` and `_` are not interchangeable. A second hyphen introduces an article (`HRS_0431-0001-0100` → `§431:1-100`) while an underscore introduces a decimal (`HRS_0001-0004_0005` → `§1-4.5`), and repeated underscores concatenate (`HRS_0011-0001_0005_0002` → `§11-1.52`). Roughly 3,000 files are numbered with the article form.
- **Parse the page, not just the path** — Section numbers are taken from the page's own bold heading, with the filename as a fallback. `numberSource` records which was used.
- **Class-driven parsing** — The pages are Word exports with a small, stable class vocabulary: `RegularParagraphs` for statute text and `XNotesHeading`/`XNotes` for annotations. The body is everything before the first `XNotesHeading`.
- **Open-ended annotations** — Annotation headings vary widely (Case Notes, Attorney General Opinions, Law Journals and Reviews, Revision Note, `COMMENTARY ON §701-100`, …), so all of them are kept as `{heading, text}` pairs rather than flattened into fixed columns. `caseNotes` and `crossReferences` remain as convenience fields.
- **Two-phase architecture** — Discovery (manifest) is separated from scraping, so the URL inventory can be built once and scraping can be resumed independently.
- **Resume support** — Progress is persisted to disk every 100 files, allowing long-running scrapes to be stopped and restarted without data loss.
- **Upsert-based storage** — All database writes use `INSERT ... ON CONFLICT DO UPDATE`, making the scraper idempotent and safe to re-run.
- **Full-text search** — A GIN-indexed `tsvector` column with weighted fields (title='A', body='B') and a `search_statutes()` function for ranked results with highlighted snippets.

## Corpus Shape

| | |
|---|---|
| Volumes | 14 |
| Chapter directories | 1,114 |
| `.htm` files | ~24,505 |
| Chapter index pages | ~1,108 |

Volume 1 also contains six non-HRS directories — `01-USCON` (US Constitution), `02-HNP`, `03-ORG`, `04-ADM`, `05-CONST` (Hawaii Constitution), and `06-HHCA` (Hawaiian Homes Commission Act). These are discovered and scraped alongside the numbered chapters and tagged with a `docType`; their section numbering is prefixed (`CONST §1-1`, `HHCA §201.5`) since they do not follow HRS chapter/article grammar.

## Parsed Output Example

Each statute section is parsed into structured data (`bodyHtml` elided):

```json
{
  "sectionNumber": "§1-2",
  "title": "Certain laws not obligatory until published.",
  "bodyText": "No written law, unless otherwise specifically provided by legislative enactment, except general or special appropriation acts, loan fund acts, pension...",
  "history": "[CC 1859, §1; RL 1925, §3; RL 1935, §3; am L 1935, c 10, §2; RL 1945, §3; RL 1955, §1-3; HRS §1-2]",
  "crossReferences": [],
  "caseNotes": "Prior to amendment spelling out that legislature may provide a different effective date, statute was so interpreted. 29 H. 250, 255. See 37 H. 260.",
  "annotations": [
    { "heading": "Case Notes", "text": "Prior to amendment spelling out that legislature..." }
  ],
  "partHeading": null,
  "chapterNumber": "1",
  "docType": "hrs",
  "isUncodified": false,
  "isRepealed": false,
  "numberSource": "page",
  "filename": "HRS_0001-0002.htm",
  "url": "https://data.capitol.hawaii.gov/hrscurrent/Vol01_Ch0001-0042F/HRS0001/HRS_0001-0002.htm"
}
```

`isUncodified` reflects a bracketed heading (`[§11-1.52]`), which the HRS uses to mark sections not yet codified into the published volumes.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **HTML Parsing**: cheerio
- **Browser Automation**: Puppeteer (fallback only)
- **Database**: PostgreSQL ([Neon](https://neon.tech))

## Setup

```bash
bun install
```

Optionally create a `.env` file for database support:

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

## Usage

### 1. Test the parser on a single page

```bash
bun run test-parse -- --url "https://data.capitol.hawaii.gov/hrscurrent/Vol01_Ch0001-0042F/HRS0001/HRS_0001-0001.htm" --save
```

Or parse a local `.htm` file, optionally dumping the full parsed object:

```bash
bun run test-parse -- --file data/html/HRS_0001-0001.htm --json
```

### 2. Discover all statute URLs

```bash
bun run discover
```

Crawls the IIS directory listings across all 14 volumes and saves a complete manifest to `data/manifest.json`. Takes a few minutes.

### 3. Scrape and parse

```bash
# Small test batch
bun run scrape -- --limit 20 --save-html

# Full scrape (saves parsed JSON locally)
bun run scrape

# Full scrape with database insertion
bun run scrape -- --db
```

| Flag | Description |
|------|-------------|
| `--db` | Upsert parsed sections into PostgreSQL |
| `--limit N` | Process only N files |
| `--save-html` | Save raw HTML to `data/html/` |
| `--concurrency N` | Workers in flight (default 5) |

### 4. Database setup

```bash
bun run migrate
```

If `DATABASE_URL` is set, runs the migration directly. Otherwise, prints the SQL schema to stdout for manual use. The schema is written to be re-runnable against an existing database.

**Schema highlights:**
- `volumes`, `chapters`, and `sections` tables with foreign key relationships
- Chapter numbers are stored without leading zeros (`1`, `6D`, `431K`) so that `sections.chapter_number` joins `chapters.number` directly
- `annotations` JSONB column holding every annotation block on the page
- GIN-indexed `tsvector` column for full-text search
- `search_statutes(query, limit, offset)` — ranked search with `<mark>`-highlighted snippets
- `get_chapter_sections(chapter)` — list all sections in a chapter
- Auto-updating `updated_at` triggers

Chapter titles are read from the chapter index pages during the scrape, so run the scrape to populate `chapters.title`.

### 5. Tests

```bash
bun test
```

The parser suite covers section-number derivation against real filenames from the corpus (including the article/decimal distinction and the handful of malformed names), heading extraction from Word's split `<b>` markup, annotation splitting, and chapter index parsing.

## Project Structure

```
src/
  config.ts        — types, constants, configuration
  discover.ts      — Phase 1: crawl directory listings -> manifest
  scrape.ts        — Phase 2: fetch, parse, store sections
  parser.ts        — HTML -> structured ParsedSection data
  parser.test.ts   — parser tests (bun test)
  fetcher.ts       — rate-limited fetching, concurrency pool, browser fallback
  db.ts            — Postgres connection and upsert helpers
  migrate.ts       — database schema migration
  test-parse.ts    — test parser against a single URL or file
sql/
  schema.sql       — standalone schema (runnable in psql or Neon SQL Editor)
data/              — runtime data (gitignored)
  manifest.json    — discovered URLs from Phase 1
  progress.json    — scrape resume state
  parsed/          — parsed JSON output
  html/            — cached raw HTML
```

## Rate Limiting

The scraper is configured to be respectful of the source server:
- 120ms minimum spacing between request starts, applied globally across workers
- 5 concurrent workers by default (`--concurrency` to change)
- 3 retries with exponential backoff, then a browser-based fallback
- Browser-like request headers

At these limits a full scrape of ~24,500 files takes roughly 45 minutes.

## License

HRS content is public domain (government works).
