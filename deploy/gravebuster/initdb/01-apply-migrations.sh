#!/usr/bin/env bash
# Apply all Octo canonical migrations in lexical order during Postgres init, and
# record each in octo.schema_migrations. Recording matters: the deploy-time runner
# (migrate.sh) skips migrations already in that table, so a database initialized
# here is seen as current and only genuinely new migrations are applied later.
# Note: /docker-entrypoint-initdb.d/ does not recurse into subdirectories, so this
# script explicitly iterates over /docker-entrypoint-initdb.d/migrations/*.sql.

set -euo pipefail

MIGRATIONS_DIR=/docker-entrypoint-initdb.d/migrations

echo "=== Applying Octo migrations from ${MIGRATIONS_DIR} ==="

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE SCHEMA IF NOT EXISTS octo;
CREATE TABLE IF NOT EXISTS octo.schema_migrations (
  filename   text        PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in "$MIGRATIONS_DIR"/*.sql; do
  if [ -f "$migration" ]; then
    name="$(basename "$migration")"
    echo "Applying: ${name}"
    {
      echo "BEGIN;"
      cat "$migration"
      echo ""
      echo "INSERT INTO octo.schema_migrations(filename) VALUES ('${name}') ON CONFLICT DO NOTHING;"
      echo "COMMIT;"
    } | psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
  fi
done

echo "=== Octo migrations applied successfully ==="
