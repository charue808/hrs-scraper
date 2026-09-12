/**
 * Push the built site to the host.
 *
 * rsync over SSH, which is what DreamHost shared hosting offers and all a
 * directory of files needs. `--delete` makes the server mirror the build, so a
 * section that leaves the code leaves the site; `--delete-delay` holds those
 * removals until the new files are in place, so a reader mid-deploy never sees
 * a gap.
 *
 *   DEPLOY_TARGET=user@server.dreamhost.com:~/hrs.example.com   # in .env
 *   bun run deploy
 *   bun run deploy -- --dry-run     # what would change, touching nothing
 *
 * Refuses a partial build: a `--chapter` or `--no-index` build is for reviewing
 * locally, and deploying one would replace the whole site with a fraction of it.
 */
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    dir: { type: "string" },
  },
  allowPositionals: true,
});

const SITE = (values.dir ?? "build/site").replace(/\/$/, "");
const TARGET = process.env.DEPLOY_TARGET;

if (!TARGET) {
  console.error("DEPLOY_TARGET is not set — put `DEPLOY_TARGET=user@host:path` in .env");
  process.exit(1);
}

// The marks of a full, indexed build. Each is written only when the whole
// corpus was rendered (build.ts) or the index actually ran.
const required = ["index.html", ".htaccess", "search/index.html", "pagefind/pagefind-entry.json"];
const missing = required.filter((f) => !existsSync(`${SITE}/${f}`));
if (missing.length) {
  console.error(`${SITE} is not a complete build — missing ${missing.join(", ")}`);
  console.error("run `bun run build` (no --chapter, no --no-index) first");
  process.exit(1);
}

if (!existsSync(`${SITE}/sitemap.xml`)) {
  console.warn("no sitemap.xml — set SITE_URL in .env and rebuild if you want one");
}

// Not -a: owner and group cannot be set on a shared host, and asking makes
// rsync complain on every file. --chmod pins what the web server needs
// regardless of the local umask. --checksum instead of --times because every
// build rewrites every file, so mtimes say nothing; comparing content sends
// only what changed, and the server keeps its mtime on everything else, which
// is what Apache's Last-Modified and ETag are made from — a reader's cached
// page still validates after a deploy that did not touch it.
const flags = [
  "--recursive",
  "--links",
  "--perms",
  "--checksum",
  "--compress",
  "--delete",
  "--delete-delay",
  "--chmod=D755,F644",
  // DreamHost's own diagnostics symlink in the web root; not ours to delete.
  "--exclude=/.dh-diag",
  "--human-readable",
  "--stats",
  ...(values["dry-run"] ? ["--dry-run", "--itemize-changes"] : ["--info=progress2"]),
];

console.log(`${values["dry-run"] ? "would sync" : "syncing"} ${SITE}/ -> ${TARGET}/`);
const started = Date.now();
const result = await Bun.$`rsync ${flags} ${SITE}/ ${TARGET}/`.nothrow();
if (result.exitCode !== 0) {
  console.error(`rsync exited ${result.exitCode}`);
  process.exit(result.exitCode);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
