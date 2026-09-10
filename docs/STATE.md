# Where the project stands

**As of**: 2026-09-09 (paused here)
**Head**: `5de5cff` — 115 tests, typecheck clean, working tree clean

Read this first. It says what exists, what is trustworthy, what is not built
yet, and where the loose threads are. The other documents go deeper:

| Document | What it is for |
|---|---|
| [`project-plan.md`](project-plan.md) | Architecture and reference for the system as built — site structure, filename grammar, HTML structure, data model |
| [`citation-linking.md`](citation-linking.md) | The citation grammar, all eight hazards, and the measured results |
| [`source-anomalies.md`](source-anomalies.md) | How errors in the published statutes are recorded and presented |
| [`progress.md`](progress.md) | Session-by-session record of what changed and why |

---

## The short version

The Hawaii Revised Statutes have been scraped, parsed into structured data,
committed as the source of truth, and cross-linked. **The corpus is done. The
site is not.**

What works end to end today: `bun run render -- --chapter 26` produces a
readable, linked, accessible chapter you can open in a browser.

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
| Size | 154 MB raw, ~33 MB gzipped, 32 MB in git |

Git is the version store. A re-scrape after a legislative session diffs to
exactly the sections that were amended, and `git log` on one file is that
section's amendment history. This depends on byte-stable serialization
(`SECTION_FIELD_ORDER` in `src/config.ts`) — `bun run reparse` reports
`unchanged 23373 changed 0` against the committed corpus, which is the check
that the property still holds.

### Citation linking — trustworthy

82.84% of body-text candidates become links; **0.16% are unresolved**. The
design is resolve-don't-match: a candidate becomes a link only when the section
it names exists in the inventory.

| Block | Linked | Unresolved |
|---|---|---|
| Body text | 82.84% | 0.16% |
| Cross References | 94.94% | 0.00% |
| Attorney General Opinions | 68.79% | 0.00% |
| Case Notes | 78.86% | 0.09% |
| Commentary | 71.45% | 1.38% |

The percentages that look low are correct: most of the gap is `bare-number`
rejections, which is the detector working. All 22,972 HRS section numbers
contain a hyphen, so a bare "section 203" is never an HRS reference.

Run `bun run profile-citations` to reproduce. It reports rejections **by
reason**, because "bare number" and "unresolved" mean opposite things.

### The renderer — a preview, not the site

`src/render.ts` renders one chapter to flat HTML files. It is deliberately
crude, and exists so citation linking could be reviewed by eye rather than only
by counts — which paid for itself immediately, surfacing four defects no count
would have shown (see `progress.md`, 2026-09-09).

It does establish the markup rules the real build needs: no JavaScript, link
text is the citation itself, `aria-label` carries the target's title, unresolved
citations stay plain text, editorial notes are real text in the document flow.

---

## What is not built

1. **The site build.** All chapters, chapter index pages, real URLs. The
   renderer handles one chapter into flat files with rewritten links.
2. **Pagefind.** No search at all yet.
3. **`citations.json`.** The graph is computed but not emitted, so there are no
   backlinks — "what cites this section?" is unanswerable. `detect()` plus
   `expandRange()` already produce everything needed.
4. **Cross-document linking.** See the correctness gap below.
5. **A host.** Not blocking: a paid Cloudflare plan clears the ~24,600 file
   output. Only the free tiers (20,000) do not.

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

- **36 sections have an empty `bodyText`.** Surfaced in the first QA pass and
  never chased. Probably banner or repeal-note pages — but "probably" is not
  good enough for a committed baseline.
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
bun test                                  # 115 tests

bun run discover                          # crawl -> data/manifest.json (~2 min)
bun run scrape --save-html                # full scrape (~45 min)
bun run reparse                           # rebuild data/parsed from cached HTML (seconds)
bun run reparse -- --dry-run              # what would change, writing nothing
bun run chapters                          # chapter titles -> data/chapters.json
bun run profile-citations                 # the citation quality metric
bun run render -- --chapter 26            # preview a chapter -> build/preview/
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
- **We do not assert what we cannot show.** Corrections need evidence and a human
  reviewer; a citation into removed text is labelled `absent-section`, not
  `repealed`, because absence is verifiable and the reason is not.
  (`source-anomalies.md`)
