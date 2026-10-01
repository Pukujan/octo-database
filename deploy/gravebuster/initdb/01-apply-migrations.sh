#!/usr/bin/env bash
# Apply all Octo canonical migrations in alphabetical order during Postgres init.
# Note: /docker-entrypoint-initdb.d/ does not recurse into subdirectories, so this
# script explicitly iterates over /docker-entrypoint-initdb.d/migrations/*.sql.

set -euo pipefail

echo "=== Applying Octo migrations from /docker-entrypoint-initdb.d/migrations ==="

for migration in /docker-entrypoint-initdb.d/migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "Applying: $(basename "$migration")"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$migration"
  fi
done

echo "=== Octo migrations applied successfully ==="
