# Where the project stands

**As of**: 2026-09-11
**Head**: see `git log` — 234 tests, typecheck clean

Read this first. It says what exists, what is trustworthy, what is not built
yet, and where the loose threads are. The other documents go deeper:

| Document | What it is for |
|---|---|
| [`project-plan.md`](project-plan.md) | Architecture and reference for the system as built — site structure, filename grammar, HTML structure, data model |
| [`citation-linking.md`](citation-linking.md) | The citation grammar, all nine hazards, and the measured results |
| [`source-anomalies.md`](source-anomalies.md) | How errors in the published statutes are recorded and presented |
| [`progress.md`](progress.md) | Session-by-session record of what changed and why |

---

## The short version

The Hawaii Revised Statutes have been scraped, parsed into structured data,
committed as the source of truth, cross-linked, and **built into a searchable
static site with backlinks**. Every known correctness gap is closed.

What works end to end today: `bun run build` turns the committed corpus into
**49,419 files** — 24,503 pages in ~6s, then ~15s for the search index — with
citations resolved, backlinks on every page, and **0 broken internal links**
across all 24,505 distinct hrefs. `bun run serve` browses it at localhost:3000,
and `bun run deploy` rsyncs it to the host.

**The host is decided: DreamHost shared hosting**, chosen 2026-09-11 to get the
site in front of people and see how it is used. Everything on the list below is
an enhancement.

---

## What exists

### The corpus — trustworthy

23,373 statute sections in `data/parsed`, committed. Scraped 2026-09-09 with
zero failures across all 24,505 files.

| | |
|---|---|
| Sections | 23,373 |
| Chapter index pages | 1,132 (1,114 dirs, 2 have no index page) |
| Number taken from the page | 22,731 (97.3%) |
| From the filename | 369 — the constitutions plus ~141 article banners |
| From a range heading | 272 |
| From the corrections ledger | 1 |
| Duplicate section numbers | **0** |
| Duplicate URL slugs | **0** (the build fails on collision) |
| Chapters with titles | 1,107 of 1,112 |
| Size | 155 MB raw, ~16 MB gzipped, 29 MiB in git |

Git is the version store. A re-scrape after a legislative session diffs to
exactly the sections that were amended, and `git log` on one file is that
section's amendment history. This depends on byte-stable serialization
(`SECTION_FIELD_ORDER` in `src/config.ts`) — `bun run reparse` reports
`unchanged 23373 changed 0` against the committed corpus, which is the check
that the property still holds.

### Citation linking — trustworthy

84.08% of body-text candidates become links; **0.15% are unresolved**. The
design is resolve-don't-match: a candidate becomes a link only when the section
it names exists in the inventory.

| Block | Linked | Unresolved |
|---|---|---|
| Body text | 84.08% | 0.15% |
| Cross References | 94.86% | 0.00% |
| Attorney General Opinions | 69.32% | 0.00% |
| Case Notes | 78.69% | 0.09% |
| Commentary | 71.41% | 1.37% |
| Legislative history | **never linked** — see hazard 9 | |
| Non-HRS documents | 305 citations linked | |

The percentages that look low are correct: most of the gap is `bare-number`
rejections, which is the detector working. All 22,972 HRS section numbers
contain a hyphen, so a bare "section 203" is never an HRS reference.

Run `bun run profile-citations` to reproduce. It reports rejections **by
reason**, because "bare number" and "unresolved" mean opposite things.

### Search and backlinks — built

**Backlinks.** `src/graph.ts` builds the citation graph — **28,811 edges** in
about a second — and the build bakes it into each page as "Cited by" and emits
the whole thing as `citations.json` (6.0 MB, byte-stable). This is the thing the
published statutes cannot do at all: a `.htm` file has no idea what points at it.

Three rules decide an edge: history is excluded (hazard 9), self-citations are
dropped, and ranges contribute their implied members labelled `range`. Body and
annotation references are kept apart because they answer different questions.
Most-cited: chapter 91 with 1,642 and §23G-15 with 410; 9,455 nodes have at
least one backlink, 96 of them in the non-HRS documents. Lists over 25 collapse into native `<details>`.

**Search.** Pagefind indexes the 24,487 statute and chapter pages — volume and
home pages are navigation and are left out. Annotations are weighted at 0.4 so a
section's own words beat the case law discussing them, and backlinks are
excluded outright. `/search` is the only page that loads a script file, and says
so if JavaScript is switched off.

**Section numbers are found by address, not by search.** Pagefind tokenizes
`26-34` into the digits `26` and `34` and prefix-matches, so §263-4 outranks
§26-34 and no weighting fixed it — measured, then the weighting was removed
rather than left in claiming to help. Instead the search page resolves a
number-shaped query to a URL and offers "Go straight to §26-34", verified with a
debounced HEAD request so no table of valid numbers ships to the browser.

**Typos are answered from the corpus, because Pagefind cannot.** It has no fuzzy
matching, and its failure mode is worse than an empty result: `marijauna` returns
3 unrelated sections and `cannabus` returns 878, rendered exactly like real hits.
Having the whole corpus makes the honest answer cheap — we know which words
appear in the statutes, so "that word is not in the HRS" is a fact, not a guess.
`search-vocabulary.txt` ships 17,223 words (52 KB gzipped, search page only) and
the client suggests the nearest with capped Damerau-Levenshtein. Transposition
costs one edit, not two, or `marijauna` corrects to `mariana` instead of
`marijuana`. Dispatch is 0.3ms.

`bun run verify-search` drives all of this in a real browser — 14 checks. Search
is the one part of the site that cannot be verified by reading the built output,
and every defect in it so far was found this way.

### The site — built

`bun run build` reads `data/parsed` and writes the whole document set.
`src/site.ts` owns the markup; `src/build.ts` owns reading the corpus and
writing files.

| | |
|---|---|
| Section pages | 23,373 |
| Chapter pages | 1,114 |
| Volume pages | 14 |
| Home, search, 404, stylesheet, favicon | 5 |
| `.htaccess`, `robots.txt`, `sitemap.xml` | 3 — see `hosting.ts` |
| `citations.json` | 6.0 MB |
| Pagefind index | 24,907 files, 115 MB |
| `search-vocabulary.txt` | 17,223 words, 52 KB gzipped |
| **Total files** | **49,419** |
| Size | 351 MB raw |
| Build time | ~6s, plus ~15s to index |
| Broken internal links | **0** of 24,505 distinct hrefs |

URLs are extensionless directories (`/hrs/26-34/index.html` serves
`/hrs/26-34`), which works on any static host without rewrite rules.

The markup rules: no script files on statute pages (the inline theme switch is
the one script, and nothing depends on it), link text is the citation exactly
as written, `aria-label` carries the target's title, unresolved citations stay
plain text, a citation into removed text is marked but not linked, editorial
notes are real text in the document flow. Every page carries a breadcrumb and a
link back to its own document on the source server; section pages carry
previous/next within the chapter.

Bracketed PART/ARTICLE banners are rendered without the brackets, with
"supplied by the revisor" in words beside them — the same trade the parser
already makes for a bracketed section heading, and it stops the banner from
reading as a rendering artifact.

Reviewing the build's output by eye is what found hazard 9 — the same thing that
happened with the preview renderer in 2026-09-09, and the second time in a row
that reading real pages beat reading counts. Reading it *again* with a second
pair of eyes found four more things, all now fixed: bracketed PART banners
dropped on 298 sections, part banners rendered twice on 1,243, ~1,600 citations
in singular-keyword lists never linked, and a "not yet codified" label the
corpus does not support.

Statute bodies are rendered with the HRS outline — `(a)` → `(1)` → `(A)` → `(i)`
— as indentation. The enumerators are enacted text, so they stay visible and the
structure is carried by indent rather than by `<ol>` markers, which would either
duplicate or replace them. Depth comes from the order each marker kind first
appears, so a section that starts at `(1)` is not indented as though a level were
missing.

---

## What is left — pick up here

Nothing here is a defect. In the order I would take them:

1. ~~**Pick a host.**~~ **Decided 2026-09-11: DreamHost shared hosting.** Plain
   Apache with SSH — no file-count cap for the 49,419 files, extensionless URLs
   by default, and server logs instead of a JavaScript tracker for seeing how
   the site is used. `bun run deploy` rsyncs the build; `src/hosting.ts` emits
   the `.htaccess`. What remains here is operational: enable a shell user and
   set `DEPLOY_TARGET`/`SITE_URL` in `.env`, deploy, and then **pull the Apache
   access logs down on a cron** — DreamHost keeps them only a few days — with a
   small `usage` script that separates bots from readers and reports which
   sections, searches and referrers actually occur.
2. **Division/Title navigation.** The site navigates by volume, which is a
   printing artifact of the published edition. The index pages carry the real
   hierarchy — `DIVISION 1. GOVERNMENT`, `TITLE 1. GENERAL PROVISIONS` — above
   the chapter banner, and it is not extracted. This is the biggest remaining
   improvement to how the site reads.
3. **Chapter index section listings.** The title, notes and annotations are
   extracted; the listing itself is not. It would make a good coverage check
   against the files actually discovered. Not needed for chapter pages — those
   are built from the parsed sections, which carry real titles.
4. **Rename `isUncodified`.** The name is wrong (see the bracket convention) and
   the field is documented as wrong in four places. Renaming rewrites all 23,373
   files, so it wants its own commit with nothing else in it — do it before the
   first real amendment diff, or never.
5. **Enhancing ranges for research.** Recorded as open question 5 in
   `citation-linking.md`. The current handling is correct and agreed; the
   question is only how much further to go.

---

## The correctness gap — closed 2026-09-10

**The 424 non-HRS files** — both constitutions, the Organic Act, the Admission
Act, the HHCA and the Hawaii National Park Act — now carry proper citations,
titles, and working links in both directions.

| | before | after |
|---|---|---|
| Titles | 1 of 400 | **280 of 400** |
| Citations into them from HRS text | 0 | **305** |
| Non-HRS pages with backlinks | 0 | 96 |

Pages are headed with the citation a lawyer would write — `Haw. Const. art. XII,
§7`, `Organic Act §73`, `Admission Act §5` — derived at render time.
`sectionNumber` stays `CONST §12-7`, because it is a stable unique key and it is
the URL; changing it would rewrite 424 files and break every link to them for no
gain the display does not already provide.

**The namespaces were never merged.** 89 non-HRS numbers collide outright with
HRS numbers and 149 are bare, so one index is how `section 2` acquires a
confident link to the Admission Act. What made this safe is that the corpus
never cites these documents without naming them — `article I, §5 of the Hawaii
constitution`, `section 203 of the Hawaiian Homes Commission Act`. The document
name is part of the citation key, resolution requires it, and a bare
`section 203` still resolves to nothing. See `cross-document.ts`.

---

## Loose threads

Small, and none of them block anything.

- ~~**36 sections have an empty `bodyText`.**~~ **Closed 2026-09-10.** All 36
  are intentionally content-free: 23 are `Renumbered as §X.` and 13 are
  `Reserved.` No body is the correct parse. Chasing it did surface something
  real, now fixed — those titles are themselves citations, and the renderer was
  escaping rather than linking them, so 23 pages whose only content is a pointer
  were dead ends.
- **48 genuinely unresolved body-text citations** remain, mostly foreign codes
  (`Cal. Evid. Code §§600-669`, federal titles cited by number). Worth a periodic
  look; the number is the metric.
- **`chapter 480-2`** — one law-journal title writes a section number after the
  word "chapter". Left unresolved deliberately: `chapter N-M` is otherwise
  almost always a Hawaii Administrative Rules citation, and resolving it as a
  section would manufacture wrong links.
- **Five chapters have no title** — three reserved ranges (807, 837, 847, e.g.
  `[CHAPTERS 807 to 830 RESERVED.]`) and two non-HRS directories (`04-ADM`,
  `05-CONST`), whose index pages carry no chapter banner. Correct as-is; the
  non-HRS ones are labelled by `NON_HRS_LABELS` in `site.ts` instead.
- **`data/html/` is not committed** (127 MB, gitignored). `bun run reparse` and
  `bun run chapters` re-fetch anything missing, so a fresh clone still works —
  it just costs a crawl.

---

## Commands

```bash
bun install
bun test                                  # 227 tests

bun run discover                          # crawl -> data/manifest.json (~2 min)
bun run scrape --save-html                # full scrape (~45 min)
bun run reparse                           # rebuild data/parsed from cached HTML (seconds)
bun run reparse -- --dry-run              # what would change, writing nothing
bun run chapters                          # chapter titles -> data/chapters.json
bun run profile-citations                 # the citation quality metric
bun run build                             # the whole site -> build/site/ (~6s + ~15s indexing)
bun run build -- --chapter 26             # one chapter, for reviewing by eye
bun run build -- --no-index               # skip Pagefind (halves the file count)
bun run serve                             # browse build/site at localhost:3000
bun run verify-search                     # drive /search in a real browser
bun run deploy -- --dry-run               # rsync build/site to DEPLOY_TARGET (.env)
```

`--db`, `bun run migrate` and `sql/schema.sql` still work but are a side tool for
ad-hoc analysis, not part of the pipeline.

---

## Things worth not re-learning

The traps that cost real time, and the measurements that settle recurring
arguments. Each is documented in full where noted.

- **`-` and `_` are not interchangeable in filenames.** A second hyphen is an
  article, an underscore is a decimal. Getting this wrong mis-numbers ~3,000
  files, and since the number is the key they collide silently.
  (`project-plan.md`, Filename Grammar)
- **`www.capitol.hawaii.gov` is behind Cloudflare; `data.capitol.hawaii.gov` is
  not** and serves identical files. A clearance cookie does not help — Cloudflare
  binds it to the TLS fingerprint. (`project-plan.md`, Hosts)
- **`[OLD]` banners precede live content**, in both section pages and chapter
  index pages. Taking the first match is wrong in both places, and it caused two
  separate defects. (`progress.md`)
- **A bare number is never an HRS section reference** — proven, not assumed: all
  22,972 HRS section numbers contain a hyphen. (`citation-linking.md`, hazard 2)
- **Hawaii Administrative Rules look exactly like HRS sections.** `§13-300-51` is
  HAR; `chapter 12-13` is an HAR chapter. Both would resolve to something real
  and wrong. (`citation-linking.md`, hazard 7)
- **`Id.` carries a citation's context from sentences away.** This produced 20
  confident links to the wrong text before it was caught.
  (`citation-linking.md`, hazard 8)
- **Hawaii adopts uniform codes under their own names**, so "of the Uniform
  Commercial Code" is an HRS citation, not a foreign one. A name-based foreign-law
  guard misfires on them. (`citation-linking.md`, hazard 2)
- **Add fields to `ParsedSection` before a corpus commit, never after.** An
  always-present field rewrites all 23,373 files; free while uncommitted, and it
  buries the first real amendment diff afterwards. (`config.ts`,
  `SECTION_FIELD_ORDER`)
- **Brackets mark revisor-supplied material, not uncodified sections.** The
  corpus says so in its own Revision Notes, and 33.6% of sections carry a
  bracketed heading — far too many to be awaiting codification. The convention
  runs through headings, catchlines, PART banners and numbers cited in running
  text, and missing it costs something at every one of those sites. The field is
  still called `isUncodified`; the name is wrong and renaming it rewrites all
  23,373 files. (`project-plan.md`, The bracket convention)
- **A list keyword is not always plural.** `section 667-22 or 667-55` is ordinary
  HRS drafting. Gating list continuation on `sections` dropped roughly 1,600
  links. (`citation-linking.md`, hazard 4)
- **Legislative history is not a set of pointers into the current code.** Every
  section number in it is a number in a *former* compilation. Linking them
  produced 971 confidently wrong links; the other 4,251 were sections linking to
  themselves. History is rendered as plain text.
  (`citation-linking.md`, hazard 9)
- **A rendered block that nothing measures is where the next defect hides.**
  `profile-citations` covered body text and annotations but never `history`, so
  5,222 links went unmeasured for a session. It now reports history as its own
  block precisely because the site does not link it.
- **`partHeading` marks only where a part begins.** It is null on every section
  after the first one in that part — 44 of chapter 26's 47. Grouping a chapter's
  contents by "the value changed" starts a fresh unlabelled list under each
  part's first section; the heading has to be carried forward.
- **Proximity does not settle which document a citation belongs to.** In `the
  Sixth Amendment to the U.S. Constitution and by Article I, Section 10, of the
  Constitution of the State of Hawaii`, the *wrong* document is nearer — 8
  characters against 9. Legal writing binds a provision to its source with "of
  the", and that construction decides it where distance cannot.
  (`citation-linking.md`, open question 4)
- **Read the source pages, not the notes about them.** The plan recorded that
  the Organic Act and HHCA "genuinely have no titles"; they have 114 between
  them, and `HEADING_RE` simply could not match the period after the number.
  Two sessions of work were planned around a claim that one `grep` disproved.
- **We do not assert what we cannot show.** Corrections need evidence and a human
  reviewer; a citation into removed text is labelled `absent-section`, not
  `repealed`, because absence is verifiable and the reason is not.
  (`source-anomalies.md`)
