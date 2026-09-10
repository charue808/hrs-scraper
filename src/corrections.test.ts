import { expect, test, describe, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { ParsedSection } from "./config";
import {
  applyCorrections,
  loadCorrections,
  sectionNumberAliases,
  type CorrectionsFile,
} from "./corrections";

const tmp = `/tmp/hrs-corrections-test-${process.pid}`;
let seq = 0;

/** Write a corrections file and load it back through the real validator. */
async function load(file: unknown) {
  const path = `${tmp}/${seq++}.json`;
  await Bun.write(path, JSON.stringify(file));
  return loadCorrections(path);
}

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const section = (over: Partial<ParsedSection> = {}): ParsedSection => ({
  sectionNumber: "§643G-2",
  title: "Scope of chapter.",
  bodyText: "",
  bodyHtml: "",
  history: "[L 2022, c 96, pt of §2]",
  crossReferences: [],
  caseNotes: "",
  annotations: [],
  partHeading: null,
  chapterNumber: "634G",
  docType: "hrs",
  isUncodified: false,
  isRepealed: false,
  covers: null,
  titleIsSupplied: false,
  sourceAnomalies: [],
  numberSource: "page",
  filename: "HRS_0634G-0002.htm",
  url: "https://x/HRS_0634G-0002.htm",
  ...over,
});

const conclusive: CorrectionsFile = {
  version: 1,
  corrections: [
    {
      filename: "HRS_0634G-0002.htm",
      field: "sectionNumber",
      observed: "§643G-2",
      corrected: "§634G-2",
      confidence: "conclusive",
      evidence: "Chapter 643G does not exist.",
      reviewedOn: "2026-09-09",
    },
  ],
};

describe("applying corrections", () => {
  test("a conclusive correction fixes the identity and records the anomaly", async () => {
    const { section: fixed } = applyCorrections(section(), await load(conclusive));

    expect(fixed.sectionNumber).toBe("§634G-2");
    expect(fixed.numberSource).toBe("correction");
    expect(fixed.sourceAnomalies).toEqual([
      {
        field: "sectionNumber",
        observed: "§643G-2",
        corrected: "§634G-2",
        confidence: "conclusive",
        evidence: "Chapter 643G does not exist.",
      },
    ]);
  });

  // The displayed text stays the source's; only the identity is corrected. The
  // rendered page shows §643G-2 with an editorial note pointing at §634G-2.
  test("the observed value survives on the anomaly record", async () => {
    const { section: fixed } = applyCorrections(section(), await load(conclusive));
    expect(fixed.sourceAnomalies[0]!.observed).toBe("§643G-2");
  });

  test("a flagged anomaly records the discrepancy without changing anything", async () => {
    const index = await load({
      version: 1,
      corrections: [
        {
          filename: "HRS_0634G-0002.htm",
          field: "sectionNumber",
          observed: "§643G-2",
          confidence: "flagged",
          evidence: "Disagrees with the directory; correct value not established.",
          reviewedOn: "2026-09-09",
        },
      ],
    });
    const { section: fixed } = applyCorrections(section(), index);

    expect(fixed.sectionNumber).toBe("§643G-2");
    expect(fixed.numberSource).toBe("page");
    expect(fixed.sourceAnomalies[0]!.corrected).toBeNull();
  });

  test("sections with no correction are untouched", async () => {
    const other = section({ filename: "HRS_0001-0002.htm", sectionNumber: "§1-2" });
    const { section: fixed, warnings } = applyCorrections(other, await load(conclusive));

    expect(fixed.sectionNumber).toBe("§1-2");
    expect(fixed.sourceAnomalies).toEqual([]);
    expect(warnings).toEqual([]);
  });

  // If the State fixes the error upstream, a re-scrape must not silently
  // re-apply a correction against text that no longer says what it claimed.
  test("a stale correction warns and is not applied", async () => {
    const upstreamFixed = section({ sectionNumber: "§634G-2" });
    const { section: fixed, warnings } = applyCorrections(upstreamFixed, await load(conclusive));

    expect(fixed.sourceAnomalies).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("not applied");
  });
});

describe("validating the ledger", () => {
  test("a missing file is not an error", async () => {
    expect((await loadCorrections(`${tmp}/does-not-exist.json`)).size).toBe(0);
  });

  test("rejects a conclusive entry with no corrected value", async () => {
    const bad = {
      version: 1,
      corrections: [{ ...conclusive.corrections[0]!, corrected: undefined }],
    };
    expect(load(bad)).rejects.toThrow(/needs "corrected"/);
  });

  // The tiers are the safeguard: "flagged" must not smuggle in a correction.
  test("rejects a flagged entry that carries a corrected value", async () => {
    const bad = {
      version: 1,
      corrections: [{ ...conclusive.corrections[0]!, confidence: "flagged" }],
    };
    expect(load(bad)).rejects.toThrow(/must not carry/);
  });

  test("rejects an unknown confidence tier", async () => {
    const bad = {
      version: 1,
      corrections: [{ ...conclusive.corrections[0]!, confidence: "probably" }],
    };
    expect(load(bad)).rejects.toThrow(/conclusive/);
  });

  test("rejects a field that is not correctable", async () => {
    const bad = {
      version: 1,
      corrections: [{ ...conclusive.corrections[0]!, field: "bodyText" }],
    };
    expect(load(bad)).rejects.toThrow(/not correctable/);
  });

  test("rejects two entries for the same file and field", async () => {
    const bad = {
      version: 1,
      corrections: [conclusive.corrections[0]!, conclusive.corrections[0]!],
    };
    expect(load(bad)).rejects.toThrow(/duplicate entry/);
  });

  test("rejects a missing evidence line", async () => {
    const bad = {
      version: 1,
      corrections: [{ ...conclusive.corrections[0]!, evidence: "" }],
    };
    expect(load(bad)).rejects.toThrow(/"evidence" is required/);
  });
});

describe("resolver aliases", () => {
  // A citation to §643G-2 elsewhere in the corpus should resolve to the page
  // published at §634G-2 rather than landing in the unresolved pile.
  test("conclusive section-number corrections become aliases", async () => {
    expect([...sectionNumberAliases(await load(conclusive))]).toEqual([["§643G-2", "§634G-2"]]);
  });

  test("flagged anomalies produce no alias", async () => {
    const index = await load({
      version: 1,
      corrections: [
        {
          filename: "HRS_0634G-0002.htm",
          field: "sectionNumber",
          observed: "§643G-2",
          confidence: "flagged",
          evidence: "Not established.",
          reviewedOn: "2026-09-09",
        },
      ],
    });
    expect(sectionNumberAliases(index).size).toBe(0);
  });
});

describe("the committed ledger", () => {
  test("data/corrections.json is valid", async () => {
    const index = await loadCorrections();
    expect(index.size).toBeGreaterThan(0);
  });
});
