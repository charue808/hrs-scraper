# hrs-scraper

A TypeScript scraper that crawls the [Hawaii Revised Statutes](https://www.capitol.hawaii.gov/hrscurrent/), parses 10,000+ statute sections from raw HTML into structured data, and stores them in PostgreSQL with full-text search.

## Motivation

The Hawaii Revised Statutes are publicly available but only as individual `.htm` files on an IIS directory server with no API or search functionality. This tool extracts the full corpus into a structured, searchable database — making it possible to build legal research tools, search interfaces, or datasets on top of the statutes.

## Key Technical Decisions

- **Puppeteer over plain HTTP** — The HRS server uses Cloudflare protection that blocks simple fetch requests. Puppeteer handles challenge pages transparently.
- **Two-phase architecture** — Discovery (manifest) is separated from scraping, so the URL inventory can be built once and scraping can be resumed independently.
- **Resume support** — Progress is persisted to disk every 100 files, allowing long-running scrapes to be stopped and restarted without data loss.
- **Upsert-based storage** — All database writes use `INSERT ... ON CONFLICT DO UPDATE`, making the scraper idempotent and safe to re-run.
- **Full-text search** — A GIN-indexed `tsvector` column with weighted fields (title='A', body='B') and a `search_statutes()` function for ranked results with highlighted snippets.

## Parsed Output Example

Each statute section is parsed into structured data:

```json
{
  "sectionNumber": "§1-2",
  "title": "Certain laws not obligatory until published.",
  "bodyText": "No written law, unless otherwise specifically provided by legislative enactment, except general or special appropriation acts, loan fund acts, pension acts, and franchise acts, shall be obligatory without first being printed and made public...",
  "history": "",
  "crossReferences": [],
  "caseNotes": "Prior to amendment spelling out that legislature may provide a different effective date, statute was so interpreted. 29 H. 250, 255...",
  "chapterNumber": "1",
  "isRepealed": false
}
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **HTML Parsing**: cheerio
- **Browser Automation**: Puppeteer
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
bun run test-parse -- --url "https://www.capitol.hawaii.gov/hrscurrent/Vol01_Ch0001-0042F/HRS0001/HRS_0001-0001.htm" --save
```

Or parse a local `.htm` file:

```bash
bun run test-parse -- --file data/html/HRS_0001-0001.htm
```

### 2. Discover all statute URLs

```bash
bun run discover
```

Crawls the IIS directory listings across all 14 volumes and saves a complete manifest to `data/manifest.json`.

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

### 4. Database setup

```bash
bun run migrate
```

If `DATABASE_URL` is set, runs the migration directly. Otherwise, prints the SQL schema to stdout for manual use.

**Schema highlights:**
- `volumes`, `chapters`, and `sections` tables with foreign key relationships
- GIN-indexed `tsvector` column for full-text search
- `search_statutes(query, limit, offset)` — ranked search with `<mark>`-highlighted snippets
- `get_chapter_sections(chapter)` — list all sections in a chapter
- Auto-updating `updated_at` triggers

## Project Structure

```
src/
  config.ts       — types, constants, configuration
  discover.ts     — Phase 1: crawl directory listings -> manifest
  scrape.ts       — Phase 2: fetch, parse, store sections
  parser.ts       — HTML -> structured ParsedSection data
  fetcher.ts      — rate-limited fetching via Puppeteer
  db.ts           — Postgres connection and upsert helpers
  migrate.ts      — database schema migration
  test-parse.ts   — test parser against a single URL or file
sql/
  schema.sql      — standalone schema (runnable in psql or Neon SQL Editor)
data/             — runtime data (gitignored)
  manifest.json   — discovered URLs from Phase 1
  progress.json   — scrape resume state
  parsed/         — parsed JSON output
  html/           — cached raw HTML
```

## Rate Limiting

The scraper is configured to be respectful of the source server:
- 350ms minimum delay between requests
- 3 retries with exponential backoff
- Browser-like request headers

The full scrape of 10,000+ files takes several hours at these limits.

## License

HRS content is public domain (government works).
