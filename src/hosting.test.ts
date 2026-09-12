import { test, expect } from "bun:test";
import { HTACCESS, robots, sitemap } from "./hosting";

test("robots keeps crawlers out of the search machinery and points at the sitemap when there is one", () => {
  const withSite = robots("https://hrs.example.com");
  expect(withSite).toContain("Disallow: /pagefind/");
  expect(withSite).toContain("Disallow: /search");
  expect(withSite).toContain("Sitemap: https://hrs.example.com/sitemap.xml");
  expect(robots(undefined)).not.toContain("Sitemap:");
});

test("sitemap is absolute, escaped, and sorted regardless of input order", () => {
  const xml = sitemap("https://hrs.example.com/", ["/hrs/26-9", "/", "/hrs/chapter/26"]);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual([
    "https://hrs.example.com/",
    "https://hrs.example.com/hrs/26-9",
    "https://hrs.example.com/hrs/chapter/26",
  ]);
  expect(sitemap("https://x", ["/a&b"])).toContain("<loc>https://x/a&amp;b</loc>");
});

test("htaccess serves the 404 page and never lists a directory", () => {
  expect(HTACCESS).toContain("ErrorDocument 404 /404.html");
  expect(HTACCESS).toContain("Options -Indexes");
  // The hashed Pagefind files are the only thing cached indefinitely.
  expect(HTACCESS).toMatch(/pf_fragment\|pf_index\|pf_meta[\s\S]*immutable/);
});
