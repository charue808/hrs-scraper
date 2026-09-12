/**
 * The files a static host needs that are not pages.
 *
 * The site is hosted on DreamHost shared hosting: Apache 2.4, configured per
 * directory through `.htaccess`, deployed with rsync over SSH. Emitting these
 * from the build keeps the server configuration in the repo rather than as a
 * hand-maintained file that a `--delete` deploy would remove.
 *
 * `SITE_URL` (from `.env`) is the site's public origin, e.g.
 * `https://hrs.example.com`. A sitemap needs absolute URLs, so it is only
 * written when that is set; `robots.txt` points at it when it exists.
 */

/**
 * Apache directives, in the order a reader would ask about them.
 *
 * Caching is decided by whether a file's name changes when its content does.
 * Pagefind's fragments, indexes and metadata are content-hashed
 * (`en_0124e14.pf_fragment`) and can be cached indefinitely; its entry point
 * is fetched with a `?ts=` cache-buster and the rest of its files
 * (`pagefind-ui.js`, `wasm.en.pagefind`) are not hashed, so they get a day.
 * Pages get an hour: the corpus changes on a legislative-session cadence, but a
 * deploy that fixes a rendering defect should reach readers the same day.
 *
 * Pagefind's binary files are already compressed internally, so `mod_deflate`
 * is scoped to text types and leaves them alone.
 */
export const HTACCESS = `# Emitted by \`bun run build\` — see src/hosting.ts. Edits here are overwritten.

# Every page is a directory holding an index.html. Nothing else should list.
Options -Indexes
DirectoryIndex index.html

ErrorDocument 404 /404.html

AddDefaultCharset utf-8
AddType image/svg+xml .svg
AddType application/json .json

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 1 hour"
  ExpiresByType text/css "access plus 1 day"
  ExpiresByType application/javascript "access plus 1 day"
  ExpiresByType text/plain "access plus 1 day"
  ExpiresByType application/json "access plus 1 hour"
  ExpiresByType image/svg+xml "access plus 1 week"
</IfModule>

<IfModule mod_headers.c>
  # Content-hashed: the name changes when the content does.
  <FilesMatch "\\.(pf_fragment|pf_index|pf_meta)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  # Pagefind's unhashed support files.
  <FilesMatch "\\.pagefind$">
    Header set Cache-Control "public, max-age=86400"
  </FilesMatch>
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain application/javascript application/json image/svg+xml
</IfModule>
`;

/**
 * Crawl the pages; leave the search machinery alone. The Pagefind fragments
 * are 24,907 files of index data that would only dilute what a crawler learns
 * about the site, and `/search` is empty without JavaScript.
 */
export function robots(siteUrl: string | undefined): string {
  const lines = ["User-agent: *", "Disallow: /pagefind/", "Disallow: /search"];
  if (siteUrl) lines.push("", `Sitemap: ${siteUrl}/sitemap.xml`);
  return `${lines.join("\n")}\n`;
}

/**
 * One sitemap, not an index of them: the protocol allows 50,000 URLs per file
 * and the site has ~24,500 pages. `lastmod` is deliberately omitted — the build
 * does not know when a section last changed, and a date that is really "when
 * the site was built" tells a crawler nothing true.
 *
 * Sorted, because the build writes pages concurrently and the file should be
 * byte-stable across builds like everything else the build emits.
 */
export function sitemap(siteUrl: string, paths: string[]): string {
  const origin = siteUrl.replace(/\/$/, "");
  const urls = [...paths]
    .sort()
    .map((p) => `  <url><loc>${escapeXml(`${origin}${p}`)}</loc></url>`);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls.join("\n")}\n</urlset>\n`
  );
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
