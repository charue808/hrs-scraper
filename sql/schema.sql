-- HRS Scraper Database Schema

CREATE TABLE IF NOT EXISTS volumes (
  id SERIAL PRIMARY KEY,
  number INTEGER UNIQUE NOT NULL,
  dir_name TEXT NOT NULL,
  chapter_range TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- chapter_number is TEXT because chapters carry letter suffixes (6D, 431K) and
-- the non-HRS directories (05-CONST, 06-HHCA) are chapters here too. Numbers
-- are stored without leading zeros so they match what the parser derives from
-- section filenames.
CREATE TABLE IF NOT EXISTS chapters (
  id SERIAL PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  dir_name TEXT NOT NULL,
  volume_number INTEGER NOT NULL REFERENCES volumes(number),
  title TEXT NOT NULL DEFAULT '',
  file_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sections (
  id SERIAL PRIMARY KEY,
  section_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '',
  cross_references TEXT[] DEFAULT '{}',
  case_notes TEXT NOT NULL DEFAULT '',
  -- Every annotation block on the page, as [{heading, text}, ...]. Pages carry
  -- an open-ended set of these (Case Notes, Attorney General Opinions, Law
  -- Journals and Reviews, Revision Note, COMMENTARY ON ..., and so on), so
  -- they are kept whole rather than flattened into fixed columns.
  annotations JSONB NOT NULL DEFAULT '[]',
  part_heading TEXT,
  chapter_number TEXT NOT NULL REFERENCES chapters(number),
  doc_type TEXT NOT NULL DEFAULT 'hrs',
  is_uncodified BOOLEAN DEFAULT FALSE,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  is_repealed BOOLEAN DEFAULT FALSE,
  fts TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_text, '')), 'B')
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Columns added after the first release, so migrations stay re-runnable
-- against a database created by an earlier version of this file.
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE sections ADD COLUMN IF NOT EXISTS annotations JSONB NOT NULL DEFAULT '[]';
ALTER TABLE sections ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'hrs';
ALTER TABLE sections ADD COLUMN IF NOT EXISTS is_uncodified BOOLEAN DEFAULT FALSE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sections_fts ON sections USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_sections_chapter ON sections (chapter_number);
CREATE INDEX IF NOT EXISTS idx_sections_doc_type ON sections (doc_type);
CREATE INDEX IF NOT EXISTS idx_chapters_volume ON chapters (volume_number);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_volumes_updated_at') THEN
    CREATE TRIGGER trg_volumes_updated_at BEFORE UPDATE ON volumes
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_chapters_updated_at') THEN
    CREATE TRIGGER trg_chapters_updated_at BEFORE UPDATE ON chapters
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sections_updated_at') THEN
    CREATE TRIGGER trg_sections_updated_at BEFORE UPDATE ON sections
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;

-- Search function with ranked results and highlighted snippets
CREATE OR REPLACE FUNCTION search_statutes(
  search_query TEXT,
  result_limit INTEGER DEFAULT 20,
  result_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  section_number TEXT,
  title TEXT,
  chapter_number TEXT,
  snippet TEXT,
  rank REAL,
  is_repealed BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.section_number,
    s.title,
    s.chapter_number,
    ts_headline('english', s.body_text, websearch_to_tsquery('english', search_query),
      'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20') AS snippet,
    ts_rank(s.fts, websearch_to_tsquery('english', search_query)) AS rank,
    s.is_repealed
  FROM sections s
  WHERE s.fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT result_limit
  OFFSET result_offset;
END;
$$ LANGUAGE plpgsql;

-- Helper to get all sections in a chapter
CREATE OR REPLACE FUNCTION get_chapter_sections(ch_number TEXT)
RETURNS TABLE (
  section_number TEXT,
  title TEXT,
  is_repealed BOOLEAN,
  part_heading TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.section_number,
    s.title,
    s.is_repealed,
    s.part_heading
  FROM sections s
  WHERE s.chapter_number = ch_number
  ORDER BY s.section_number;
END;
$$ LANGUAGE plpgsql;
