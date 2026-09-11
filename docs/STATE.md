# Where the project stands

**As of**: 2026-09-10
**Head**: 203 tests, typecheck clean

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
committed as the source of truth, cross-linked, and **built into a static
site**. What is missing now is search, backlinks, proper citations for the
non-HRS documents, and a host.

What works end to end today: `bun run build` turns the committed corpus into
24,503 files in under five seconds — every section, every chapter, every volume,
with citations resolved and **0 broken internal links** across all 24,503
distinct hrefs.

---

## What exists

### The corpus — trustworthy

23,373 statute sections in `data/parsed`, committed. Scraped 2026-09-09 with
zero failures across all 24,505 files.

| | |
|---|---|
| Sections | 23,373 |
| Chapter index pages | 1,132 |
| Chapters with titles | 1,106 of 1,112 (1,114 dirs, 2 have no index page) |
| Number taken from the page | 22,560 (96.5%) |
| From the filename | 541 — the 400 non-HRS documents plus ~141 article banners |
| From a range heading | 272 |
| From the corrections ledger | 1 |
| Duplicate section numbers | **0** |
| Duplicate URL slugs | **0** (the build fails on collision) |
| Size | 154 MB raw, ~33 MB gzipped, 32 MB in git |

Git is the version store. A re-scrape after a legislative session diffs to
exactly the sections that were amended, and `git log` on one file is that
section's amendment history. This depends on byte-stable serialization
(`SECTION_FIELD_ORDER` in `src/config.ts`) — `bun run reparse` reports
`unchanged 23373 changed 0` against the committed corpus, which is the check
that the property still holds.

### Citation linking — trustworthy

83.31% of body-text candidates become links; **0.15% are unresolved**. The
design is resolve-don't-match: a candidate becomes a link only when the section
it names exists in the inventory.

| Block | Linked | Unresolved |
|---|---|---|
| Body text | 83.31% | 0.15% |
| Cross References | 94.86% | 0.00% |
| Attorney General Opinions | 69.32% | 0.00% |
| Case Notes | 78.62% | 0.09% |
| Commentary | 71.41% | 1.37% |
| Legislative history | **never linked** — see hazard 9 | |

The percentages that look low are correct: most of the gap is `bare-number`
rejections, which is the detector working. All 22,972 HRS section numbers
contain a hyphen, so a bare "section 203" is never an HRS reference.

Run `bun run profile-citations` to reproduce. It reports rejections **by
reason**, because "bare number" and "unresolved" mean opposite things.

### Search and backlinks — built

**Backlinks.** `src/graph.ts` builds the citation graph — **28,547 edges** in
about a second — and the build bakes it into each page as "Cited by" and emits
the whole thing as `citations.json` (6.0 MB, byte-stable). This is the thing the
published statutes cannot do at all: a `.htm` file has no idea what points at it.

Three rules decide an edge: history is excluded (hazard 9), self-citations are
dropped, and ranges contribute their implied members labelled `range`. Body and
annotation references are kept apart because they answer different questions.
Most-cited: chapter 91 with 1,642 and §23G-15 with 410; 8,758 sections have at
least one backlink. Lists over 25 collapse into native `<details>`.

**Search.** Pagefind indexes the 24,487 statute and chapter pages — volume and
home pages are navigation and are left out. Annotations are weighted at 0.4 so a
section's own words beat the case law discussing them, and backlinks are
excluded outright. `/search` is the only page that loads JavaScript, and says so
if it is switched off.

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
| Home, search, stylesheet, favicon | 4 |
| `citations.json` | 6.0 MB |
| Pagefind index | 24,907 files, 115 MB |
| **Total files** | **49,413** |
| Size | 351 MB raw |
| Build time | ~6s, plus ~17s to index |
| Broken internal links | **0** of 24,503 distinct hrefs |

URLs are extensionless directories (`/hrs/26-34/index.html` serves
`/hrs/26-34`), which works on any static host without rewrite rules.

The markup rules: no JavaScript on any page, link text is the citation exactly
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

## What is not built

1. **Cross-document linking.** See the correctness gap below.
2. **A host.** Now the sharpest constraint, because Pagefind writes one fragment
   per indexed page: the build emits **49,413 files**, not 24,503. A paid
   Cloudflare plan (100,000) still clears it with room; both free tiers (20,000)
   are now out of reach by more than twice over. `--no-index` halves the count if
   that ever matters more than search.
3. **Division/Title navigation.** The site navigates by volume, which is a
   printing artifact. The index pages carry the real structure —
   `DIVISION 1. GOVERNMENT`, `TITLE 1. GENERAL PROVISIONS` — and it is not
   extracted yet.
4. **Chapter index section listings.** Only the title, notes and annotations are
   taken from an index page. The listing itself would make a good coverage check
   against the files actually discovered. Not needed for the build: chapter
   contents are derived from the parsed sections, which carry real titles.

---

## The one known correctness gap

**The 424 non-HRS files** — both constitutions, the Organic Act, the Admission
Act, and the Hawaiian Homes Commission Act — are scraped and tagged but numbered
as prefixed identifiers (`CONST §1-1`) rather than proper citations
(`Haw. Const. art. I, §1`). Constitution titles are missed entirely, since the
title sits in centered paragraphs above a `Section n.` heading.

HRS text names these documents **306 times** and none of those citations can be
linked. The namespaces are deliberately kept apart in the resolver: 89 non-HRS
numbers collide outright with HRS numbers (`1-2` is both HRS §1-2 and
CONST §1-2) and 149 are bare, so merging them is how `section 2` would acquire a
confident link to the Admission Act.

Deferred until the site build is done — but it is the last thing standing
between the current state and "citations are correct".

---

## Loose threads

Small, and none of them block the site build.

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
- **Six chapters have no title** — three reserved ranges
  (`[CHAPTERS 807 to 830 RESERVED.]`) and the three non-HRS directories. Correct
  as-is.
- **`data/html/` is not committed** (127 MB, gitignored). `bun run reparse` and
  `bun run chapters` re-fetch anything missing, so a fresh clone still works —
  it just costs a crawl.

---

## Commands

```bash
bun install
bun test                                  # 203 tests

bun run discover                          # crawl -> data/manifest.json (~2 min)
bun run scrape --save-html                # full scrape (~45 min)
bun run reparse                           # rebuild data/parsed from cached HTML (seconds)
bun run reparse -- --dry-run              # what would change, writing nothing
bun run chapters                          # chapter titles -> data/chapters.json
bun run profile-citations                 # the citation quality metric
bun run build                             # the whole site -> build/site/ (~5s)
bun run build -- --chapter 26             # one chapter, for reviewing by eye
bun run build -- --no-index               # skip Pagefind (halves the file count)
bun run serve                             # browse build/site at localhost:3000
bun run verify-search                     # drive /search in a real browser
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
- **We do not assert what we cannot show.** Corrections need evidence and a human
  reviewer; a citation into removed text is labelled `absent-section`, not
  `repealed`, because absence is verifiable and the reason is not.
  (`source-anomalies.md`)
