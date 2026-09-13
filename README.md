# hrs-scraper

A TypeScript pipeline that crawls the [Hawaii Revised Statutes](https://www.capitol.hawaii.gov/hrscurrent/),
parses ~24,500 statute files from raw HTML into structured data, and publishes
them as a static, fully cross-linked document set.

**Current state**: the corpus is scraped, parsed, committed and cross-linked,
and the site builds — 24,546 pages with search, backlinks and no broken
internal links — and deploys to a plain Apache host with `bun run deploy`.
See [`docs/STATE.md`](docs/STATE.md).

## Motivation

The Hawaii Revised Statutes are publicly available but only as individual `.htm`
files on an IIS directory server with no API and no search. Worse, every
reference one statute makes to another is dead text — you cannot follow a
citation without manually working out which file it lives in.

This tool extracts the full corpus into structured data, resolves those
citations into real links, and renders the result as a static site.

## Architecture

**The product is a static site.** The corpus is read-only, public domain,
carries no personalization, and changes on a legislative-session cadence.
Nothing a database provides *at runtime* is something this content needs.

| Concern | Decision |
|---|---|
| Source of truth | `data/parsed/*.json`, committed to the repo |
| Version history | git — a re-scrape diffs to exactly the sections that were amended |
| Output | 23,373 statute pages + 1,114 chapter pages + 41 title pages + 14 volume pages + a tree view, pre-rendered HTML |
| Citations | resolved at build time and baked into the markup |
| Search | [Pagefind](https://pagefind.app) — chunked index; only the search page loads JS |
| Database | optional side tool for ad-hoc analysis, not the pipeline |

Statute pages load no script files. The one script they carry is a ~20-line
inline theme switch that the markup never depends on — with JavaScript off the
page is identical minus the button, and follows the system colour scheme.
`/search` is the one page that loads a script file (Pagefind).

### Why git is the version store

A re-scrape after a legislative session rewrites the corpus, and git diffs it to
exactly the sections that changed. `git log` on one file *is* that section's
amendment history, with real diffs — strictly better than a `section_versions`
table, and free.

This only works if serialization is byte-stable, so `serializeSection()` writes
a declared key order (`SECTION_FIELD_ORDER` in `src/config.ts`) rather than
relying on object-literal insertion order. Without that, reordering a literal in
the parser would silently churn all 24,505 files and make every future diff
worthless.

## Key Technical Decisions

- **The `data.capitol.hawaii.gov` mirror** — `www.capitol.hawaii.gov` sits behind
  Cloudflare and returns 403 to anything that is not a real browser. The `data`
  host serves byte-identical files with no bot protection, so ordinary `fetch`
  works and the scrape runs with real concurrency. Puppeteer is kept only as a
  per-request fallback and is never launched on the happy path.
- **The filename separator carries meaning** — `-` and `_` are not
  interchangeable. A second hyphen introduces an article (`HRS_0431-0001-0100` →
  `§431:1-100`) while an underscore introduces a decimal (`HRS_0001-0004_0005` →
  `§1-4.5`), and repeated underscores concatenate (`HRS_0011-0001_0005_0002` →
  `§11-1.52`). 3,129 sections use the article form.
- **Parse the page, not just the path** — Section numbers are taken from the
  page's own bold heading, with the filename as a fallback. `numberSource`
  records which was used; 97.7% of sections come from the page.
- **Class-driven parsing** — The pages are Word exports with a small, stable
  class vocabulary: `RegularParagraphs` for statute text and
  `XNotesHeading`/`XNotes` for annotations. The body is everything before the
  first `XNotesHeading`.
- **Open-ended annotations** — Annotation headings vary widely (Case Notes,
  Attorney General Opinions, Law Journals and Reviews, Revision Note,
  `COMMENTARY ON §701-100`, …), so all of them are kept as `{heading, text}`
  pairs rather than flattened into fixed columns. `caseNotes` and
  `crossReferences` remain as convenience fields.
- **Resolve citations, don't pattern-match them** — `manifest.json` is a complete
  inventory of every file, which yields the exact set of valid section numbers.
  Candidates are looked up against it; what resolves becomes a link, what does
  not stays plain text and gets counted. A wrong link in a legal document is
  worse than no link. See [`docs/citation-linking.md`](docs/citation-linking.md).
- **Cross-document citations resolve through the document's name** — the
  constitutions, Organic Act, Admission Act and HHCA share number space with the
  HRS (89 outright collisions), so their indexes are kept separate and a
  citation resolves only when it names its document. 305 such links.
- **The source has errors, and we say so** — the published HRS contains
  typographical mistakes. We correct a section's *identity* so navigation works,
  keep its *displayed text* faithful to the source, and attach a generated
  editorial note explaining the discrepancy. See
  [`docs/source-anomalies.md`](docs/source-anomalies.md).
- **Two-phase pipeline** — Discovery is separated from scraping, so the URL
  inventory is built once and scraping can be resumed independently.

## Corpus Shape

Scraped in full on 2026-09-09 with zero failures.

| | |
|---|---|
| Divisions / titles | 5 / 41 — the code's own arrangement, read from the 41 index pages that carry the banners |
| Volumes | 14 — how the printed edition is bound, and how the source server is organised |
| Chapter directories | 1,114 |
| `.htm` files | 24,505 |
| Parsed sections | 23,373 |
| Chapter index pages | 1,132 |
| Parsed JSON | 155 MB raw, ~16 MB gzipped |

Volume 1 also contains six non-HRS directories — `01-USCON` (US Constitution),
`02-HNP`, `03-ORG` (Organic Act), `04-ADM` (Admission Act), `05-CONST` (Hawaii
Constitution), and `06-HHCA` (Hawaiian Homes Commission Act). These are
discovered and scraped alongside the numbered chapters and tagged with a
`docType`; their section numbering is prefixed (`CONST §1-1`, `HHCA §201.5`)
since they do not follow HRS chapter/article grammar.

## Parsed Output Example

Each statute section is parsed into structured data (`bodyHtml` elided):

```json
{
  "sectionNumber": "§1-2",
  "title": "Certain laws not obligatory until published.",
  "chapterNumber": "1",
  "docType": "hrs",
  "partHeading": null,
  "bodyText": "No written law, unless otherwise specifically provided by legislative enactment, except general or special appropriation acts, loan fund acts, pension...",
  "history": "[CC 1859, §1; RL 1925, §3; RL 1935, §3; am L 1935, c 10, §2; RL 1945, §3; RL 1955, §1-3; HRS §1-2]",
  "crossReferences": [],
  "caseNotes": "Prior to amendment spelling out that legislature may provide a different effective date, statute was so interp...",
  "annotations": [
    {
      "heading": "Case Notes",
      "text": "Prior to amendment spelling out that legislature may provide..."
    }
  ],
  "headingIsSupplied": false,
  "isRepealed": false,
  "covers": null,
  "titleIsSupplied": false,
  "sourceAnomalies": [],
  "numberSource": "page",
  "filename": "HRS_0001-0002.htm",
  "url": "https://data.capitol.hawaii.gov/hrscurrent/Vol01_Ch0001-0042F/HRS0001/HRS_0001-0002.htm"
}
```

Field notes, in the order they appear:

- `headingIsSupplied` — the heading was bracketed (`[§11-1.52]`): brackets mark
  material *supplied by the revisor* rather than enacted by the legislature,
  not an uncodified section — 33.6% of the corpus carries one. The rendered
  pages say "heading supplied by the revisor". (Called `isUncodified` until
  2026-09-12; the rename is its own commit.)
- `covers` — set on the 272 pages whose heading states a span rather than one
  section (`§515-10 to 515-12 REPEALED.`). A range heading cannot say which of
  its members a given file is, so those take their number from the filename and
  `numberSource` reads `page-range`.
- `titleIsSupplied` — the bracket wrapped only the *title*
  (`§604-13 [Arrest under warrant.]`), marking a catchline supplied editorially
  rather than enacted. 13 sections.
- `sourceAnomalies` — discrepancies between the page and the truth, from the
  reviewed `data/corrections.json`. Empty on all but one section today.

`bodyHtml` is retained as a fallback for debugging parse issues but is never
rendered — pages are built from the structured fields, which is what gives
control over the markup for accessibility. It is 46% of the payload and is
serialized last so it stays out of the way in diffs.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **HTML parsing**: cheerio
- **Browser automation**: Puppeteer (fallback only)
- **Search**: Pagefind
- **Database** (optional): PostgreSQL, via the built-in `Bun.SQL`

## Setup

```bash
bun install
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

Crawls the IIS directory listings across all 14 volumes and writes a complete
manifest to `data/manifest.json`. Takes about two minutes.

### 3. Scrape and parse

```bash
bun run scrape --limit 20 --save-html   # small test batch
bun run scrape --save-html              # full run, ~45 min
```

| Flag | Description |
|------|-------------|
| `--save-html` | Save raw HTML to `data/html/` |
| `--limit N` | Process only N files |
| `--concurrency N` | Workers in flight (default 5) |
| `--db` | Also upsert into PostgreSQL (optional; see below) |

`--save-html` is recommended for any full run. It costs ~127 MB of gitignored,
disposable disk and turns a later parse bug into a seconds-long local re-parse
instead of another 24,505-request crawl against a government server.

Progress is written to `data/progress.json` every 100 files, so a long run can
be stopped and resumed. Delete that file to force a re-parse of everything.

### 4. Re-parse after a parser change

```bash
bun run reparse                 # rebuild data/parsed from data/html
bun run reparse -- --dry-run    # report what would change, write nothing
```

Rebuilds the corpus from cached HTML in seconds rather than re-crawling. Pages
missing from the cache are fetched and cached, so a partial cache still yields a
complete corpus. Duplicate section numbers are reported the same way the scraper
reports them.

### 5. Build the site

```bash
bun run build                    # the whole corpus -> build/site/ (~6s + ~17s indexing)
bun run build -- --chapter 26    # one chapter, for reviewing by eye
bun run build -- --no-index      # skip Pagefind
bun run build -- --out dist
bun run serve                    # browse it at localhost:3000
bun run verify-search            # drive /search in a real browser (needs Chrome)
```

Emits 49,461 files: a page per section, per chapter, per title and per volume,
plus a tree view of the whole hierarchy, a home page, a search page, `citations.json`, and the Pagefind index — which is 24,907
of them, one fragment per indexed page. `--no-index` skips Pagefind and halves
the count. `bun run serve` browses the result at `localhost:3000`; the pages are
extensionless directories (`/hrs/26-34/index.html` serves `/hrs/26-34`), which
a static host resolves and `file://` does not. Only `/search` loads a script file.

A full build also writes what the host needs — `.htaccess`, `robots.txt`,
`404.html`, and `sitemap.xml` when `SITE_URL` is set in `.env` — and clears the
`hrs/` and `pagefind/` directories first, so a section that leaves the code
after a re-scrape leaves the site too.

The build fails loudly on a URL-slug collision — the same protection the scraper
applies to section numbers, one layer down.

### 6. Tests

```bash
bun test
```

The suite covers section-number derivation against real filenames from the
corpus (including the article/decimal distinction and the handful of malformed
names), heading extraction from Word's split `<b>` markup, annotation splitting,
chapter index parsing, and the rendering rules the site depends on — what gets
linked, what deliberately does not, and how a chapter's parts are grouped.

### Optional: PostgreSQL

The database is **not** part of the publishing pipeline. It is kept because
`--db` plus SQL is a convenient way to run ad-hoc analysis across the corpus
during development.

```bash
echo 'DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require' > .env
bun run migrate
bun run scrape --db
```

Bun loads `.env` automatically. If `DATABASE_URL` is unset, `migrate` prints the
schema to stdout instead of applying it. The schema is re-runnable against an
existing database, and provides `volumes` / `chapters` / `sections` tables, a
GIN-indexed `tsvector` for full-text search, `search_statutes()` for ranked
results with highlighted snippets, and `get_chapter_sections()`.

## Deployment

The site is hosted on DreamHost shared hosting — plain Apache 2.4 with SSH —
and deployed with rsync:

```bash
cat >> .env <<'ENV'
SITE_URL=https://hrs.example.com
DEPLOY_TARGET=user@server.dreamhost.com:~/hrs.example.com
ENV
bun run build
bun run deploy -- --dry-run     # what would change, touching nothing
bun run deploy
```

`deploy` refuses anything but a complete, indexed build, syncs with `--delete`
so the server mirrors the build exactly, and holds deletions until the new files
are in place. The server configuration lives in `src/hosting.ts` and is emitted
as `.htaccess` by the build: no directory listings, the 404 page, and cache
headers keyed on whether a file's name changes with its content (Pagefind's
hashed fragments are immutable; pages get an hour).

**Why a plain host.** The build emits **49,461 files** — Pagefind writes one
fragment per indexed page, which more than doubles the page count — and that is
over the free tier of every CDN-style host checked (Cloudflare Pages and Workers
both cap free at 20,000 files; paid at 100,000). An Apache directory has no cap,
extensionless URLs are its `DirectoryIndex` behaviour (with `DirectorySlash
Off` so it serves `/hrs/26-34` rather than redirecting to `/hrs/26-34/` first), and its access
logs answer "how is this being used?" without adding JavaScript to statute
pages.

**The logs.** DreamHost rotates the access log daily and deletes rotated days
after a few of them, so a cron *on the host* (a laptop that is off for a week
would lose a week) gzips each rotated day into `~/log-archive/` as it appears.
`src/archive-logs.sh` is that script; `bun run logs -- --install` puts it and
its crontab in place, and `bun run logs` pulls the archive to `data/logs/`,
which is gitignored — the lines carry IP addresses.

## Possible Direction: An Enhanced Site

Static is the right default, and this section exists so that staying static
stays a *choice* rather than a constraint nobody revisited.

**The corpus does not care how it is rendered.** `data/parsed/*.json` is the
source of truth, and every downstream artifact — HTML, a search index, a
Postgres row, a JSON API — is derived from it. Moving to a dynamic site is a
change to the render target, not a re-scrape and not a data migration. `db.ts`,
`migrate.ts` and `sql/schema.sql` are retained precisely so that path is a
wiring exercise rather than a rewrite.

So the guidance is: **do not build for these until a feature actually demands
one.** But know which features cross the line.

### Features that stay comfortably static

- Full-text search (Pagefind)
- Citation links, resolved at build time
- **Backlinks** — "what cites this section?" is a precomputed reverse index,
  emitted as `citations.json` and baked into each page
- A JSON API — just files on disk, one per section
- Diffs between two published snapshots, pre-rendered from git history

### Features that need a backend

| Feature | Why it crosses the line |
|---|---|
| Proximity / boolean search (`negligence w/5 damages`) | Legal researchers expect it; Pagefind does not do it |
| Change alerts ("email me when chapter 431 is amended") | Needs scheduling, subscriptions, delivery |
| User accounts, saved searches, private annotations | Per-user state |
| Interactive citation-graph exploration (N hops out) | Traversal over a graph too large to ship whole |
| Arbitrary point-in-time queries ("§X-Y as of any date") | Pre-rendering every version of every section does not scale |
| Usage analytics per section | Server-side collection |

### A middle tier worth knowing about

Most of the above does not require abandoning static rendering. Statute pages
can stay pre-rendered while a small edge function handles the few dynamic
endpoints — search, alert signup, graph queries. That keeps the property that
matters most here: **the statutes themselves render without JavaScript**, so
they stay fast, archivable, and accessible even if the dynamic layer is down.

The escalation order, cheapest first:

1. **Static** (current) — pre-rendered HTML + Pagefind.
2. **Static + edge functions** — pages unchanged; dynamic endpoints only.
3. **Static + a real backend** — the existing Postgres schema, populated by
   `--db`, serving search and graph queries behind the same static pages.
4. **Full application** — only if per-user state becomes central, which would be
   a different product than "the statutes, readable and linked."

### Adjacent data sources

The [LRB session reports](https://lrb.hawaii.gov/publications/session-reports/)
publish per-session act lists as PDFs. They are a plausible second source for
detecting what changed in a legislative session — a way to know *which* sections
to expect diffs in, rather than inferring it after the fact from a re-scrape.
Not yet evaluated.

## Project Structure

```
src/
  config.ts        — types, constants, SECTION_FIELD_ORDER, serializeSection
  fetcher.ts       — rate-limited fetching, concurrency pool, browser fallback
  discover.ts      — crawl directory listings -> manifest
  scrape.ts        — fetch, parse, write sections
  reparse.ts       — rebuild data/parsed from cached HTML after a parser change
  chapters.ts      — chapter titles from index pages -> data/chapters.json; the
                     Division > Title > Chapter hierarchy -> data/titles.json
  parser.ts        — HTML -> structured ParsedSection data
  corrections.ts   — applies data/corrections.json; resolver alias table
  resolver.ts      — the known-section index, and resolution against it
  citations.ts     — detect, resolve and link citations
  cross-document.ts — citations into the constitutions and the other non-HRS acts
  graph.ts         — the citation graph: backlinks and citations.json
  vocabulary.ts    — the corpus's word list, for typo suggestions on the search page
  search-client.js — the search page's script: go-to-section and spelling suggestions
  site.ts          — the site's markup: page shell, section/chapter/title/volume/tree pages
  build.ts         — reads the corpus, resolves citations, writes build/site
  hosting.ts       — what the host needs beyond pages: .htaccess, robots, sitemap
  deploy.ts        — rsync build/site to the host
  logs.ts          — pull the access-log archive; --install sets up the host cron
  archive-logs.sh  — runs on the host under cron: gzip each rotated day before it ages out
  serve.ts         — serves build/site locally (development only)
  verify-search.ts — drives /search in a real browser
  profile-citations.ts — the citation quality metric
  coverage.ts      — index-page section listings vs the corpus, both directions
  coverage.ts      — index-page section listings vs the corpus, both directions
  test-parse.ts    — test parser against a single URL or file
  *.test.ts        — 234 tests (bun test)
  db.ts, migrate.ts — Postgres side tool (optional)
sql/
  schema.sql       — standalone schema (runnable in psql or the Neon SQL Editor)
docs/
  STATE.md             — where the project stands; read this first
  project-plan.md      — architecture and design reference
  progress.md          — what changed and why, session by session
  citation-linking.md  — citation grammar, hazards, and the resolver design
  source-anomalies.md  — how errors in the published statutes are handled
data/
  manifest.json    — discovered URLs from discovery (tracked)
  chapters.json    — chapter number -> title (tracked)
  titles.json      — Division > Title > (Subtitle) > Chapter, from the 41 title banner pages (tracked)
  corrections.json — reviewed errors in the published source (tracked)
  parsed/          — parsed JSON, the source of truth (tracked)
  html/            — cached raw HTML (gitignored)
  progress.json    — scrape resume state (gitignored)
```

## Rate Limiting

The scraper is deliberately gentle with the source server:

- 120ms minimum spacing between request starts, applied **globally** across
  workers — raising `--concurrency` never raises the request rate
- 5 concurrent workers by default
- 3 retries with exponential backoff, then a browser-based fallback
- Browser-like request headers

At these limits a full scrape of 24,505 files takes roughly 45 minutes.

## License

HRS content is public domain (government works).
