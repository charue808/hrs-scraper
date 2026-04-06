// --- Types ---

export interface Volume {
  number: number;
  dirName: string; // e.g. "Vol01_Ch0001-0042F"
  chapterRange: string; // e.g. "0001-0042F"
  chapters: Chapter[];
}

export interface Chapter {
  number: string; // e.g. "0001" or "0431K"
  dirName: string; // e.g. "HRS0001"
  volumeNumber: number;
  files: SectionFile[];
}

export interface SectionFile {
  filename: string; // e.g. "HRS_0001-0001.htm"
  url: string;
  isIndex: boolean; // true for chapter index pages like "HRS_0001-.htm"
}

export interface ParsedSection {
  sectionNumber: string; // e.g. "§1-1" or "§431:10A-601"
  title: string;
  bodyText: string;
  bodyHtml: string;
  history: string; // legislative history "[L 1972, c 9, ...]"
  crossReferences: string[];
  caseNotes: string;
  partHeading: string | null;
  chapterNumber: string;
  filename: string;
  url: string;
  isRepealed: boolean;
}

export interface Manifest {
  createdAt: string;
  baseUrl: string;
  volumes: Volume[];
  totalFiles: number;
}

export interface Progress {
  lastUpdated: string;
  completedFiles: string[]; // URLs already processed
  failedFiles: { url: string; error: string }[];
}

// --- Constants ---

export const BASE_URL = "https://www.capitol.hawaii.gov/hrscurrent/";
export const ALT_BASE_URL = "https://capitol.hawaii.gov/hrscurrent/";

export const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

export const RATE_LIMIT_MS = 350;
export const MAX_CONCURRENT = 2;
export const MAX_RETRIES = 3;
export const RETRY_BACKOFF_MS = 1000;

export const DATA_DIR = "data";
export const MANIFEST_PATH = `${DATA_DIR}/manifest.json`;
export const PROGRESS_PATH = `${DATA_DIR}/progress.json`;
export const PARSED_DIR = `${DATA_DIR}/parsed`;
export const HTML_DIR = `${DATA_DIR}/html`;

export const DATABASE_URL = process.env.DATABASE_URL;
