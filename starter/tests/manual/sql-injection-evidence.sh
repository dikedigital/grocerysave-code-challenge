#!/usr/bin/env bash
# Proof from Postgres itself that user input never reaches SQL as text (security pass).
#   bash tests/manual/sql-injection-evidence.sh [postgres log file]       (default ~/.local/gs-postgres.log)
# Turns on log_statement = 'all' for the TEST database only, runs tests/manual/security-check.ts
# with a marker unique to this run in every payload, turns the logging off again (also on Ctrl+C),
# and sorts the logged entries that contain the marker (tests/manual/sql-log-check.ts).
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
LOG_FILE=${1:-$HOME/.local/gs-postgres.log}
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must be set}"
DB=$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$TEST_DATABASE_URL")
case "$DB" in *test*) ;; *) echo "refusing: $DB is not a test database" >&2; exit 2 ;; esac
[ -r "$LOG_FILE" ] || { echo "cannot read the Postgres log $LOG_FILE" >&2; exit 2; }
ADMIN_URL=$(node -e 'const u=new URL(process.argv[1]); u.pathname="/postgres"; console.log(u.toString())' "$TEST_DATABASE_URL")
MARKER="INJ$(date +%s)X"
off() { psql "$ADMIN_URL" -qc "ALTER DATABASE \"$DB\" RESET log_statement" >/dev/null; }
trap off EXIT
psql "$ADMIN_URL" -qc "ALTER DATABASE \"$DB\" SET log_statement = 'all'" || exit 1
echo "log_statement = all for database $DB (new sessions); marker $MARKER"
OFFSET=$(stat -c %s "$LOG_FILE")
LOG_LEVEL=silent npx tsx tests/manual/security-check.ts --marker "$MARKER" > /tmp/security-check-for-sql.md 2>&1
echo "security-check.ts: exit $? (report in /tmp/security-check-for-sql.md)"
off; trap - EXIT
echo "log_statement reset for $DB"
echo
npx tsx tests/manual/sql-log-check.ts "$LOG_FILE" "$OFFSET" "$MARKER"
