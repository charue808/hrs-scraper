import { parseSection, filenameToSectionNumber } from "./parser";
import { fetchPage, closeBrowser } from "./fetcher";
import { DATA_DIR } from "./config";
import { parseArgs } from "util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    url: { type: "string" },
    file: { type: "string" },
    save: { type: "boolean", default: false },
  },
  strict: true,
});

if (!values.url && !values.file) {
  console.log("Usage:");
  console.log("  bun src/test-parse.ts --url <url> [--save]");
  console.log("  bun src/test-parse.ts --file <path>");
  console.log("");
  console.log("Options:");
  console.log("  --url   Fetch and parse a remote .htm file");
  console.log("  --file  Parse a local .htm file");
  console.log("  --save  Save fetched HTML to data/html/");
  process.exit(1);
}

let html: string;
let filename: string;
let url: string;

if (values.url) {
  url = values.url;
  filename = url.split("/").pop() ?? "unknown.htm";
  console.log(`Fetching: ${url}\n`);
  html = await fetchPage(url);

  if (values.save) {
    await Bun.$`mkdir -p ${DATA_DIR}/html`.quiet();
    await Bun.write(`${DATA_DIR}/html/${filename}`, html);
    console.log(`Saved HTML to ${DATA_DIR}/html/${filename}\n`);
  }
} else {
  const filePath = values.file!;
  filename = filePath.split("/").pop() ?? "unknown.htm";
  url = `local://${filePath}`;
  const file = Bun.file(filePath);
  html = await file.text();
}

console.log(`Filename: ${filename}`);
console.log(`Section number from filename: ${filenameToSectionNumber(filename)}`);
console.log("---\n");

const parsed = parseSection(html, filename, url);

console.log(`Section Number: ${parsed.sectionNumber}`);
console.log(`Title: ${parsed.title}`);
console.log(`Chapter: ${parsed.chapterNumber}`);
console.log(`Repealed: ${parsed.isRepealed}`);
console.log(`Part Heading: ${parsed.partHeading ?? "(none)"}`);
console.log("");
console.log(`--- Body Text (first 500 chars) ---`);
console.log(parsed.bodyText.substring(0, 500));
console.log("");
console.log(`--- History ---`);
console.log(parsed.history || "(none)");
console.log("");
console.log(`--- Cross References (${parsed.crossReferences.length}) ---`);
for (const ref of parsed.crossReferences.slice(0, 10)) {
  console.log(`  ${ref}`);
}
if (parsed.crossReferences.length > 10) {
  console.log(`  ... and ${parsed.crossReferences.length - 10} more`);
}
console.log("");
console.log(`--- Case Notes (first 300 chars) ---`);
console.log(parsed.caseNotes.substring(0, 300) || "(none)");

await closeBrowser();
