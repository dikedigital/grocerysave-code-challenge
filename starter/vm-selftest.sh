#!/usr/bin/env bash
# Run this inside the Ubuntu VM, in the unpacked starter (with node_modules in place), BEFORE the
# model starts. It needs no network. Every line should print OK.
#
#   cd <starter>; DATABASE_URL=... TEST_DATABASE_URL=... bash vm-selftest.sh
set -u
fail=0
ok()   { echo "OK    $1"; }
bad()  { echo "FAIL  $1"; fail=1; }
check() { # check <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi
}

echo "machine: $(uname -sm), node $(node -v 2>/dev/null || echo missing)"

node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' && ok "Node.js 20 or newer" || bad "Node.js 20 or newer"
[ -d node_modules ] && ok "node_modules present" || bad "node_modules present (unpack the bundle for this CPU: $(uname -m))"
[ -f TECH_SPEC.md ] && [ -f package.json ] && ok "starter files present" || bad "starter files present (run from the repository root)"

check "tsc runs"        npx --no-install tsc --version
check "tsx runs (esbuild binary matches this CPU)" npx --no-install tsx -e 'console.log(1)'
check "jest runs"       npx --no-install jest --version
check "vite runs (rollup binary matches this CPU)" npx --no-install vite --version
check "npm run typecheck passes" npm run -s typecheck
check "npm run lint passes"      npm run -s lint
check "npm run build passes"     npm run -s build

for var in DATABASE_URL TEST_DATABASE_URL; do
  url="${!var:-}"
  if [ -z "$url" ]; then bad "$var is set"; continue; fi
  if node -e '
    const { Client } = require("pg");
    const c = new Client({ connectionString: process.argv[1] });
    c.connect()
      .then(() => c.query("SELECT current_setting($$server_version_num$$)::int AS v, gen_random_uuid() AS u"))
      .then((r) => { if (r.rows[0].v < 130000) throw new Error("PostgreSQL 13 or newer is required"); })
      .then(() => c.query("CREATE SCHEMA IF NOT EXISTS gs_selftest; DROP SCHEMA gs_selftest"))
      .then(() => c.end(), (e) => { console.error(e.message); process.exit(1); });
  ' "$url" 2>/dev/null; then ok "$var connects, PostgreSQL 13+, can create and drop schemas"; else bad "$var connects, PostgreSQL 13+, can create and drop schemas"; fi
done

[ "$fail" -eq 0 ] && echo "ALL OK" || echo "SOMETHING FAILED"
exit "$fail"
