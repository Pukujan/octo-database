# Octo Self-Hosting Runbook (Gravebuster)

This runbook covers hosting Octo on the `gravebuster` host at `https://octodb.design-bakery.com`, managing promotions through the `production` branch, and troubleshooting deployments.

---

## 1. Architecture Overview

Octo runs as a three-container Docker Compose project on gravebuster:

```
                      Cloudflare Tunnel (study-os-cloudflared-1)
                                      │  study-os_edge
                                      ▼
                          ┌───────────────────────┐
   octodb.design-bakery ─▶│  octo-web  (Caddy 2)  │  127.0.0.1:8091
   .com                   │  static dist + proxy  │
                          └───────────┬───────────┘
                                      │ /api/*, /health
                                      ▼
                          ┌───────────────────────┐
                          │  octo-api (Node 22)   │  internal only
                          │  tsx src/server/...   │
                          └───────────┬───────────┘
                                      │ postgres://
                                      ▼
                          ┌───────────────────────┐
                          │  octo-db              │  internal only
                          │  pgvector/pgvector:16 │  volume: octo-db-data
                          └───────────────────────┘
```

- **`octo-web`** (`caddy:2-alpine`): Serves Vite static production assets from `/srv`, serves `/healthz` for container liveness, and reverse-proxies `/api/*` and `/health` to `octo-api:3001`.
- **`octo-api`** (`node:22-bookworm-slim`): Platform server running `tsx src/server/index.ts`.
- **`octo-db`** (`pgvector/pgvector:pg16`): Dedicated Postgres database with Supabase auth scaffolding and canonical migrations loaded on init.

---

## 2. Prerequisites & Owner Actions

Before running on gravebuster, ensure:

1. **Google OAuth Authorized Redirect URI**:
   Add `https://octodb.design-bakery.com/api/auth/google/callback` to the authorized redirect URIs for your Google OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

2. **Cloudflare Tunnel Routing**:
   Map `octodb.design-bakery.com` to `http://octo-web:80` inside the Cloudflare Zero Trust tunnel dashboard (using the existing `study-os-cloudflared-1` tunnel on the `study-os_edge` Docker network).

3. **Port Check**:
   Confirm port `8091` is open on gravebuster (port 8090 is in use by groktocrawl):
   ```bash
   ss -ltn | grep ':8091 '
   ```

---

## 3. Initial Deployment Setup

1. **Clone repository onto gravebuster**:
   ```bash
   mkdir -p ~/apps
   git clone https://github.com/Pukujan/octo-database.git ~/apps/octo
   cd ~/apps/octo
   git checkout production
   ```

2. **Configure production environment**:
   ```bash
   cp deploy/gravebuster/.env.example deploy/gravebuster/.env
   chmod 600 deploy/gravebuster/.env
   nano deploy/gravebuster/.env
   ```
   Provide:
   - `PUBLIC_BASE_URL=https://octodb.design-bakery.com`
   - `POSTGRES_PASSWORD=<strong_random_password>`
   - `DATABASE_URL=postgresql://postgres:<strong_random_password>@octo-db:5432/postgres`
   - `GOOGLE_OAUTH_CLIENT_ID` & `GOOGLE_OAUTH_CLIENT_SECRET`
   - `OCTO_MEDIA_SECRET=<random_32_byte_secret>`
   - Cloudflare R2 & Google Drive credentials

3. **Initial build and start**:
   ```bash
   cd ~/apps/octo/deploy/gravebuster
   ./deploy.sh
   ```

4. **Install systemd autodeploy timer**:
   ```bash
   mkdir -p ~/.config/systemd/user
   cp systemd/octo-autodeploy.{service,timer} ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now octo-autodeploy.timer
   ```

---

## 4. Promotion & Continuous Deployment Workflow

1. Development takes place on feature branches and merges to `main` via auto-merge on green CI gates.
2. When ready to promote to production:
   - Open a pull request from `main` into `production`.
   - CI runs the full `gates` validation suite on the PR.
   - The owner reviews and merges the PR into `production`.
3. Within 5 minutes, the systemd timer on gravebuster invokes `autodeploy.sh`:
   - Detects the new commit on `origin/production`.
   - Runs `deploy.sh`.
   - Builds SHA-tagged images and starts containers.
   - Verifies health within 90 seconds.
   - Runs smoke test.
   - If smoke test fails, automatically rolls back to the previous image.

---

## 5. Manual Rollback

If a manual rollback is ever required:
```bash
cd ~/apps/octo/deploy/gravebuster
./rollback.sh
```

---

## 6. Local Podman Testing (WSL)

To test the container stack locally before deployment:
```bash
cd deploy/local
cp .env.example .env
podman-compose up -d --build
```
Then visit `http://localhost:8095` to test the UI and API locally.
