/**
 * Serve the built site locally.
 *
 * The build emits extensionless directories — `/hrs/26-34` is
 * `hrs/26-34/index.html` — which is what real static hosts do for you and what
 * `file://` does not, so the site is not browsable straight off disk. This is
 * the smallest thing that behaves like the host will.
 *
 * Development only: it reads from disk on every request so a rebuild shows up
 * on reload, and it is not hardened for anything but localhost.
 *
 *   bun run serve
 *   bun run serve -- --port 8080 --dir build/site
 */
import { parseArgs } from "node:util";
import { statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { port: { type: "string" }, dir: { type: "string" } },
  allowPositionals: true,
});

const ROOT = resolve(values.dir ?? "build/site");
const PORT = Number(values.port ?? 3000);

try {
  if (!statSync(ROOT).isDirectory()) throw new Error("not a directory");
} catch {
  console.error(`no site at ${ROOT} — run \`bun run build\` first`);
  process.exit(1);
}

/** The file a request path maps to, or null. Directories fall back to index.html. */
function fileFor(pathname: string): string | null {
  // Confine to ROOT before touching the filesystem: a path can still escape
  // after decoding (`/../../etc/passwd`), and resolve() is what collapses it.
  const target = resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;

  try {
    const stats = statSync(target);
    if (stats.isFile()) return target;
    if (stats.isDirectory()) {
      const index = join(target, "index.html");
      if (statSync(index).isFile()) return index;
    }
  } catch {
    // ENOENT and friends: nothing here.
  }
  return null;
}

// The same page the host serves (`ErrorDocument 404` in .htaccess), when the
// build wrote one; a --chapter build does not.
const NOT_FOUND_FILE = join(ROOT, "404.html");
const FALLBACK_NOT_FOUND = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Not found</title>
<link rel="stylesheet" href="/style.css"></head>
<body><main class="wrap"><h1>404</h1>
<p>No page at that address. <a href="/">Start from the top</a>.</p></main></body></html>
`;

const server = Bun.serve({
  port: PORT,
  fetch(request) {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const file = fileFor(pathname);
    if (!file) {
      const page = Bun.file(NOT_FOUND_FILE);
      return new Response(page.size ? page : FALLBACK_NOT_FOUND, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    // Bun infers the content type from the extension.
    return new Response(Bun.file(file), {
      headers: { "cache-control": "no-cache" },
    });
  },
});

console.log(`serving ${ROOT} at http://localhost:${server.port}`);
console.log(`  try  http://localhost:${server.port}/hrs/26-9`);
