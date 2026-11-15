#!/usr/bin/env bash
# Runs a command and saves its full output to logs/tests/<UTC timestamp>-<label>.log.
# Usage: tests/run-logged.sh <label> <command> [args...]
#   e.g. tests/run-logged.sh unit npm run test:unit
# The exit code of the command is preserved. logs/ is git-ignored.
set -uo pipefail
if [ $# -lt 2 ]; then echo "usage: $0 <label> <command> [args...]" >&2; exit 2; fi
label=$1; shift
cd "$(dirname "$0")/.." || exit 2
mkdir -p logs/tests
log="logs/tests/$(date -u +%Y%m%dT%H%M%SZ)-${label}.log"
{
  echo "# command : $*"
  echo "# started : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# commit  : $(git rev-parse --short HEAD 2>/dev/null) ($(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') uncommitted paths)"
  echo "# node    : $(node --version)"
  echo
} > "$log"
"$@" 2>&1 | tee -a "$log"
status=${PIPESTATUS[0]}
printf '\n# exit    : %s\n# finished: %s\n' "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log"
echo "[log saved to $log, exit $status]"
exit "$status"
