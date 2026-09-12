/**
 * The access logs: archive them on the host, pull them down here.
 *
 * The site is up to see how it is used, and Apache's access log is how —
 * without a script on any page. DreamHost keeps a rotated day's log only a few
 * days, so a cron on the host (not on a laptop that may be off) copies each
 * day into ~/log-archive/ as it rotates; see archive-logs.sh. This script
 * installs that and fetches the result.
 *
 *   bun run logs                 # rsync the archive to data/logs/
 *   bun run logs -- --install    # put archive-logs.sh and its crontab on the host
 *
 * The host and user come from DEPLOY_TARGET in .env. data/logs/ is gitignored:
 * the lines carry IP addresses, and a reader's visit is not part of the corpus.
 */
import { parseArgs } from "node:util";
import { readdirSync, statSync } from "node:fs";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { install: { type: "boolean", default: false } },
});

const TARGET = process.env.DEPLOY_TARGET;
if (!TARGET) {
  console.error("DEPLOY_TARGET is not set — put `DEPLOY_TARGET=user@host:path` in .env");
  process.exit(1);
}
const HOST = TARGET.split(":")[0]; // user@host
const LOCAL = "data/logs";

// Twice a day: rotation is at 00:43 host time, so 01:30 gets yesterday as soon
// as it is whole, and 13:30 is a second chance if the first run was missed.
const MARK = "# hrs-scraper: archive access logs (src/logs.ts)";
const CRON = `30 1,13 * * * $HOME/bin/archive-logs >> $HOME/log-archive/cron.log 2>&1`;

if (values.install) {
  console.log(`installing archive-logs on ${HOST}`);
  await Bun.$`ssh ${HOST} mkdir -p bin log-archive`;
  await Bun.$`scp -q src/archive-logs.sh ${HOST}:bin/archive-logs`;
  await Bun.$`ssh ${HOST} chmod 755 bin/archive-logs`;
  // Replace our entry if present, keep anything else in the crontab.
  const existing = await Bun.$`ssh ${HOST} crontab -l`.nothrow().text();
  const kept = existing
    .split("\n")
    .filter((l) => l.trim() && l !== MARK && !l.includes("bin/archive-logs"));
  const crontab = [...kept, MARK, CRON, ""].join("\n");
  await Bun.$`echo ${crontab} | ssh ${HOST} crontab -`;
  console.log("crontab:");
  console.log(await Bun.$`ssh ${HOST} crontab -l`.text());
  console.log("first run:");
  const first = await Bun.$`ssh ${HOST} bin/archive-logs`.text();
  console.log(first || "  nothing rotated yet");
}

console.log(`pulling ${HOST}:log-archive/ -> ${LOCAL}/`);
const result = await Bun.$`rsync --recursive --times --compress --quiet ${HOST}:log-archive/ ${LOCAL}/`.nothrow();
if (result.exitCode !== 0) {
  console.error(`rsync exited ${result.exitCode}`);
  process.exit(result.exitCode);
}

// What is here now, per domain: how many days, and how much.
for (const domain of readdirSync(LOCAL, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const files = readdirSync(`${LOCAL}/${domain.name}`).filter((f) => f.endsWith(".access.log.gz"));
  const days = new Set(files.map((f) => f.slice(0, 10)));
  const bytes = files.reduce((n, f) => n + statSync(`${LOCAL}/${domain.name}/${f}`).size, 0);
  const sorted = [...days].sort();
  console.log(
    `${domain.name}: ${days.size} day${days.size === 1 ? "" : "s"}` +
      (sorted.length ? ` (${sorted[0]} .. ${sorted.at(-1)})` : "") +
      `, ${(bytes / 1024).toFixed(0)} KB gzipped`,
  );
}
