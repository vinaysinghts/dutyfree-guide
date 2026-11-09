#!/usr/bin/env bash
# Applies the migrations to a scratch database and runs the SQL tests.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="dutyfree_test_$$"
psql -q -c "create database $db"
trap 'psql -q -c "drop database $db"' EXIT
psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$here/00_supabase_stubs.sql"
for f in "$here"/../migrations/*.sql; do psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$here/../seed.sql"
psql -d "$db" -v ON_ERROR_STOP=1 -f "$here/10_review_flow.sql"
