import { DATABASE_URL } from "./config";
import type { ParsedSection, Volume, Chapter } from "./config";

let sql: InstanceType<typeof Bun.SQL> | null = null;

export function getDb(): InstanceType<typeof Bun.SQL> {
  if (!sql) {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    sql = new Bun.SQL(DATABASE_URL);
  }
  return sql;
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.close();
    sql = null;
  }
}

export async function upsertVolume(volume: Volume): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO volumes (number, dir_name, chapter_range)
    VALUES (${volume.number}, ${volume.dirName}, ${volume.chapterRange})
    ON CONFLICT (number) DO UPDATE SET
      dir_name = EXCLUDED.dir_name,
      chapter_range = EXCLUDED.chapter_range
  `;
}

export async function upsertChapter(chapter: Chapter): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO chapters (number, dir_name, volume_number, file_count)
    VALUES (${chapter.number}, ${chapter.dirName}, ${chapter.volumeNumber}, ${chapter.files.length})
    ON CONFLICT (number) DO UPDATE SET
      dir_name = EXCLUDED.dir_name,
      volume_number = EXCLUDED.volume_number,
      file_count = EXCLUDED.file_count
  `;
}

export async function upsertSection(section: ParsedSection): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO sections (
      section_number, title, body_text, body_html, history,
      cross_references, case_notes, part_heading,
      chapter_number, filename, url, is_repealed
    ) VALUES (
      ${section.sectionNumber}, ${section.title}, ${section.bodyText},
      ${section.bodyHtml}, ${section.history},
      ${section.crossReferences}, ${section.caseNotes},
      ${section.partHeading},
      ${section.chapterNumber}, ${section.filename}, ${section.url},
      ${section.isRepealed}
    )
    ON CONFLICT (section_number) DO UPDATE SET
      title = EXCLUDED.title,
      body_text = EXCLUDED.body_text,
      body_html = EXCLUDED.body_html,
      history = EXCLUDED.history,
      cross_references = EXCLUDED.cross_references,
      case_notes = EXCLUDED.case_notes,
      part_heading = EXCLUDED.part_heading,
      chapter_number = EXCLUDED.chapter_number,
      filename = EXCLUDED.filename,
      url = EXCLUDED.url,
      is_repealed = EXCLUDED.is_repealed
  `;
}
