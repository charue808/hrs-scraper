import * as cheerio from "cheerio";
import type { ParsedSection } from "./config";

/**
 * Convert HRS filename to section number.
 * Examples:
 *   HRS_0291-0003_0001.htm → §291-3.1
 *   HRS_0431-0010A-0601.htm → §431:10A-601
 *   HRS_0001-0001.htm → §1-1
 *   HRS_0001-0001_0005.htm → §1-1.5
 */
export function filenameToSectionNumber(filename: string): string {
  // Remove extension and HRS_ prefix
  const base = filename.replace(/\.htm$/i, "").replace(/^HRS_/, "");

  // Split by hyphens and underscores
  // Pattern: CCCC-SSSS or CCCC-SSSS_DDDD or CCCC-PPPP-SSSS (colon notation)
  const parts = base.split(/[-_]/);

  if (parts.length < 2) return `§${base}`;

  const chapter = stripLeadingZeros(parts[0]!);

  if (parts.length === 2) {
    // Simple: §chapter-section
    const section = stripLeadingZeros(parts[1]!);
    return `§${chapter}-${section}`;
  }

  if (parts.length === 3) {
    // Could be: subsection (chapter-section_decimal) or colon notation (chapter-article-section)
    // Heuristic: if parts[1] contains letters, it's likely an article (colon notation)
    const part1 = parts[1]!;
    const part2 = parts[2]!;

    if (/[A-Za-z]/.test(part1) && part1.length <= 5) {
      // Colon notation: §chapter:article-section
      const article = stripLeadingZeros(part1);
      const section = stripLeadingZeros(part2);
      return `§${chapter}:${article}-${section}`;
    }

    // Decimal subsection: §chapter-section.decimal
    const section = stripLeadingZeros(part1);
    const decimal = stripLeadingZeros(part2);
    return `§${chapter}-${section}.${decimal}`;
  }

  if (parts.length === 4) {
    // Colon notation with decimal: §chapter:article-section.decimal
    const article = stripLeadingZeros(parts[1]!);
    const section = stripLeadingZeros(parts[2]!);
    const decimal = stripLeadingZeros(parts[3]!);
    return `§${chapter}:${article}-${section}.${decimal}`;
  }

  // Fallback
  return `§${parts.map(stripLeadingZeros).join("-")}`;
}

function stripLeadingZeros(s: string): string {
  // Preserve letters at the end (e.g., "010A" → "10A")
  const match = s.match(/^0*(\d+.*)$/);
  if (match) return match[1] || "0";
  return s;
}

/** Extract chapter number from filename */
export function extractChapterFromFilename(filename: string): string {
  const base = filename.replace(/\.htm$/i, "").replace(/^HRS_/, "");
  const parts = base.split(/[-_]/);
  return stripLeadingZeros(parts[0]!);
}

/** Parse a statute HTML page into structured data */
export function parseSection(
  html: string,
  filename: string,
  url: string
): ParsedSection {
  const $ = cheerio.load(html);

  const chapterNumber = extractChapterFromFilename(filename);
  const sectionNumber = filenameToSectionNumber(filename);

  // Extract title - usually in a bold or heading element near the top
  let title = "";
  // Try <b> tag containing section number pattern
  $("b, strong").each((_, el) => {
    const text = $(el).text().trim();
    if (text.includes("§") || text.match(/^\d+-/)) {
      title = text;
      return false; // break
    }
  });

  // Fallback: try <title> tag
  if (!title) {
    title = $("title").text().trim();
  }

  // Clean up title - remove section number prefix if embedded in title
  title = title.replace(/^\s*§[\d:A-Za-z.-]+\s*/, "").trim();

  // Check if section is repealed
  const isRepealed =
    /\bREPEALED\b/i.test(title) ||
    /\bREPEALED\b/i.test($("body").text().substring(0, 500));

  // Extract body - the main content between title and history
  const bodyEl = $("body").clone();
  // Remove script/style tags
  bodyEl.find("script, style").remove();

  const fullText = bodyEl.text();
  const bodyHtml = $("body").html() ?? "";

  // Extract legislative history - matches [L YYYY, ...] patterns
  let history = "";
  const historyMatch = fullText.match(/\[L\s+\d{4}.*?\]/s);
  if (historyMatch) {
    history = historyMatch[0].trim();
  }

  // Extract body text (between title and history/cross-refs/case notes)
  let bodyText = fullText;

  // Try to isolate the main body content
  const sectionMarkers = [
    "Cross References",
    "cross references",
    "CROSS REFERENCES",
    "Law Journals and Reviews",
    "LAW JOURNALS AND REVIEWS",
    "Case Notes",
    "CASE NOTES",
    "Rules of Court",
    "RULES OF COURT",
    "Attorney General Opinions",
    "ATTORNEY GENERAL OPINIONS",
  ];

  let bodyEnd = bodyText.length;
  for (const marker of sectionMarkers) {
    const idx = bodyText.indexOf(marker);
    if (idx !== -1 && idx < bodyEnd) {
      bodyEnd = idx;
    }
  }

  // Also cut at history bracket if present
  if (historyMatch) {
    const histIdx = bodyText.indexOf(historyMatch[0]);
    if (histIdx !== -1 && histIdx < bodyEnd) {
      bodyEnd = histIdx;
    }
  }

  bodyText = bodyText.substring(0, bodyEnd).trim();

  // Remove title from body text start
  if (title && bodyText.startsWith(title)) {
    bodyText = bodyText.substring(title.length).trim();
  }

  // Extract cross references
  const crossReferences: string[] = [];
  const crMatch = fullText.match(
    /Cross References?\s*([\s\S]*?)(?=(?:Case Notes|Law Journals|Rules of Court|Attorney General|\[L\s+\d{4}|$))/i
  );
  if (crMatch) {
    const refs = crMatch[1]!
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    crossReferences.push(...refs);
  }

  // Extract case notes
  let caseNotes = "";
  const cnMatch = fullText.match(
    /Case Notes?\s*([\s\S]*?)(?=(?:\[L\s+\d{4}|$))/i
  );
  if (cnMatch) {
    caseNotes = cnMatch[1]!.trim();
  }

  // Extract part heading if present
  let partHeading: string | null = null;
  $("b, strong, h2, h3, h4").each((_, el) => {
    const text = $(el).text().trim();
    if (/^(PART|Part)\s+[IVXLCDM\d]+/i.test(text)) {
      partHeading = text;
      return false;
    }
  });

  return {
    sectionNumber,
    title,
    bodyText: cleanText(bodyText),
    bodyHtml,
    history,
    crossReferences,
    caseNotes: cleanText(caseNotes),
    partHeading,
    chapterNumber,
    filename,
    url,
    isRepealed,
  };
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
