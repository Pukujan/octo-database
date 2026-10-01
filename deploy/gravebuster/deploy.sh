#!/usr/bin/env bash
# Octo Deploy Script (Gravebuster)
# Builds images tagged by git SHA, swaps containers, validates health & smoke, auto-rolls back on failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

STATE_FILE=".deploy-state"
COMPOSE_FILES=("-f" "docker-compose.yml")
if [ -f "docker-compose.edge.yml" ]; then
  COMPOSE_FILES+=("-f" "docker-compose.edge.yml")
fi

TARGET_SHA="${1:-$(git rev-parse HEAD)}"
IMAGE_TAG="${TARGET_SHA:0:12}"

echo "=== Deploying Octo @ commit ${IMAGE_TAG} ==="

PREVIOUS_IMAGE="latest"
if [ -f "$STATE_FILE" ]; then
  # shellcheck source=/dev/null
  source "$STATE_FILE"
  PREVIOUS_IMAGE="${CURRENT_IMAGE:-latest}"
fi

export IMAGE_TAG

echo "1. Building container images..."
docker compose "${COMPOSE_FILES[@]}" build octo-api octo-web

echo "2. Starting containers..."
docker compose "${COMPOSE_FILES[@]}" up -d

echo "3. Waiting for services to become healthy..."
MAX_WAIT=90
WAITED=0
HEALTHY=false

if [ -z "${WEB_HOST_PORT:-}" ] && [ -f ".env" ]; then
  ENV_PORT=$(grep -E '^WEB_HOST_PORT=' .env | cut -d= -f2 | tr -d ' "\r' || true)
  if [ -n "$ENV_PORT" ]; then
    WEB_HOST_PORT="$ENV_PORT"
  fi
fi
WEB_HOST_PORT="${WEB_HOST_PORT:-8091}"

while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  if curl -fsS "http://127.0.0.1:${WEB_HOST_PORT}/healthz" >/dev/null 2>&1; then
    HEALTH_STATUS=$(curl -fsS "http://127.0.0.1:${WEB_HOST_PORT}/health" 2>/dev/null || echo "{}")
    DB_CONNECTED=$(echo "$HEALTH_STATUS" | grep -o '"connected":true' || true)
    if [ -n "$DB_CONNECTED" ]; then
      HEALTHY=true
      break
    fi
  fi
  sleep 3
  WAITED=$((WAITED + 3))
  echo "   Waiting for health... (${WAITED}s / ${MAX_WAIT}s)"
done

if [ "$HEALTHY" != "true" ]; then
  echo "ERROR: Health check timed out after ${MAX_WAIT} seconds."
  echo "Triggering automated rollback..."
  ./rollback.sh
  exit 1
fi

echo "4. Running smoke tests..."
# Smoke test A: Root UI returns 200
HTTP_INDEX=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${WEB_HOST_PORT}/")
if [ "$HTTP_INDEX" != "200" ]; then
  echo "ERROR: Smoke test failed: GET / returned HTTP ${HTTP_INDEX} (expected 200)"
  ./rollback.sh
  exit 1
fi

# Smoke test B: Unauthenticated API access returns 401
HTTP_WORKSPACES=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${WEB_HOST_PORT}/api/workspaces")
if [ "$HTTP_WORKSPACES" != "401" ]; then
  echo "ERROR: Smoke test failed: GET /api/workspaces returned HTTP ${HTTP_WORKSPACES} (expected 401)"
  ./rollback.sh
  exit 1
fi

echo "5. Recording successful deployment..."
cat <<EOF > "$STATE_FILE"
SHA="${TARGET_SHA}"
CURRENT_IMAGE="${IMAGE_TAG}"
PREVIOUS_IMAGE="${PREVIOUS_IMAGE}"
DEPLOYED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
EOF

echo "=== Deployment successful: Octo @ ${IMAGE_TAG} is live on http://127.0.0.1:${WEB_HOST_PORT} ==="
