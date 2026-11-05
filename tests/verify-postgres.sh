#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to an isolated disposable Postgres database}"
PSQL=${PSQL:-psql}
"$PSQL" "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/prepare-local-roles.sql
"$PSQL" "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/001_vehicle_positions.sql
"$PSQL" "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/postgres.test.sql
