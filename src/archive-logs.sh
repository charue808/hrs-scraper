#!/bin/bash
# Keep DreamHost's rotated Apache logs before they age out.
#
# Runs on the host under cron, installed by `bun run logs -- --install` (see
# src/logs.ts). Apache rotates ~/logs/<domain>/{http,https}/access.log daily
# into access.log.YYYY-MM-DD and DreamHost deletes those after a few days. Each
# dated file is gzipped once into ~/log-archive/<domain>/, keyed by date, so
# running this again is free and running it late loses nothing that is still
# on disk. `bun run logs` pulls the archive down.
set -eu
ARCHIVE="$HOME/log-archive"

for dir in "$HOME"/logs/*/http*/; do
  [ -d "$dir" ] || continue
  domain=$(basename "$(dirname "$dir")")
  scheme=$(basename "$dir")
  # Dated files only: access.log is still being written and access.log.0 is a
  # symlink to the newest dated one.
  for f in "$dir"access.log.20[0-9][0-9]-* "$dir"error.log.20[0-9][0-9]-*; do
    [ -f "$f" ] || continue
    name=$(basename "$f")     # access.log.2026-09-11
    kind=${name%%.*}          # access
    date=${name##*.}          # 2026-09-11
    out="$ARCHIVE/$domain/$date.$scheme.$kind.log.gz"
    [ -e "$out" ] && continue
    mkdir -p "$(dirname "$out")"
    gzip -c "$f" > "$out.tmp" && mv "$out.tmp" "$out"
    echo "$(date '+%F %T') archived $domain/$scheme/$name ($(stat -c %s "$f") bytes)"
  done
done
