import { parseArgs } from "util";
import { HTML_DIR } from "./config";
import { closeBrowser, fetchPage } from "./fetcher";
import {
  filenameToSectionNumber,
  isIndexFilename,
  parseChapterIndex,
  parseSection,
} from "./parser";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    url: { type: "string" },
    file: { type: "string" },
    save: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
  strict: true,
});

if (!values.url && !values.file) {
  console.log("Usage:");
  console.log("  bun src/test-parse.ts --url <url> [--save] [--json]");
  console.log("  bun src/test-parse.ts --file <path> [--json]");
  console.log("");
  console.log("Options:");
  console.log("  --url   Fetch and parse a remote .htm file");
  console.log("  --file  Parse a local .htm file");
  console.log("  --save  Save fetched HTML to data/html/");
  console.log("  --json  Print the full parsed object as JSON");
  process.exit(1);
}

let html: string;
let filename: string;
let url: string;

if (values.url) {
  url = values.url;
  filename = decodeURIComponent(url.split("/").pop() ?? "unknown.htm");
  console.log(`Fetching: ${url}\n`);
  html = await fetchPage(url);

  if (values.save) {
    await Bun.$`mkdir -p ${HTML_DIR}`.quiet();
    await Bun.write(`${HTML_DIR}/${filename}`, html);
    console.log(`Saved HTML to ${HTML_DIR}/${filename}\n`);
  }
} else {
  const filePath = values.file!;
  filename = filePath.split("/").pop() ?? "unknown.htm";
  url = `local://${filePath}`;
  html = await Bun.file(filePath).text();
}

await closeBrowser();

if (isIndexFilename(filename)) {
  const index = parseChapterIndex(html, filename, url);
  console.log(`Chapter index page`);
  console.log(`Chapter: ${index.chapterNumber}`);
  console.log(`Title:   ${index.title || "(none)"}`);
  if (values.json) console.log(`\n${JSON.stringify(index, null, 2)}`);
  process.exit(0);
}

const parsed = parseSection(html, filename, url);

if (values.json) {
  console.log(JSON.stringify(parsed, null, 2));
  process.exit(0);
}

console.log(`Filename: ${filename}`);
console.log(`Section number from filename: ${filenameToSectionNumber(filename)}`);
console.log("---\n");
console.log(`Section Number: ${parsed.sectionNumber}  (from ${parsed.numberSource})`);
console.log(`Title:          ${parsed.title || "(none)"}`);
console.log(`Chapter:        ${parsed.chapterNumber}`);
console.log(`Doc type:       ${parsed.docType}`);
console.log(`Repealed:       ${parsed.isRepealed}`);
console.log(`Uncodified:     ${parsed.isUncodified}`);
console.log(`Part Heading:   ${parsed.partHeading ?? "(none)"}`);
console.log("");
console.log(`--- Body Text (${parsed.bodyText.length} chars, first 500) ---`);
console.log(parsed.bodyText.substring(0, 500));
console.log("");
console.log(`--- History ---`);
console.log(parsed.history || "(none)");
console.log("");
console.log(`--- Cross References (${parsed.crossReferences.length}) ---`);
for (const ref of parsed.crossReferences.slice(0, 10)) console.log(`  ${ref}`);
if (parsed.crossReferences.length > 10) {
  console.log(`  ... and ${parsed.crossReferences.length - 10} more`);
}
console.log("");
console.log(`--- Annotations (${parsed.annotations.length}) ---`);
for (const annotation of parsed.annotations) {
  console.log(`  [${annotation.heading}] ${annotation.text.slice(0, 90).replace(/\n/g, " ")}...`);
}
