#!/usr/bin/env bash
# Flake audit (todo.md Phase 11): run the default suite N times in a row and
# fail on the *first* non-green run.
#
#   ./scripts/flake-audit.sh        # 10 runs (the CI default)
#   ./scripts/flake-audit.sh 3      # a quick local check while editing
#
# A test that passes nine times out of ten is a broken test, and this project
# claims zero tolerance for flakes — the concurrency suite is only meaningful if
# the rest of the suite is boringly reliable.
set -euo pipefail

RUNS="${1:-10}"
cd "$(dirname "$0")/.."

failed=0
for run in $(seq 1 "$RUNS"); do
  if npm test > "/tmp/flake-audit-$run.log" 2>&1; then
    printf 'run %2d/%d  ✓\n' "$run" "$RUNS"
  else
    printf 'run %2d/%d  ✗  (see /tmp/flake-audit-%d.log)\n' "$run" "$RUNS" "$run"
    failed=$((failed + 1))
  fi
done

if [ "$failed" -gt 0 ]; then
  printf '\n%d of %d runs failed — that is a flake, not bad luck.\n' "$failed" "$RUNS"
  exit 1
fi
printf '\n%d/%d runs green.\n' "$RUNS" "$RUNS"
