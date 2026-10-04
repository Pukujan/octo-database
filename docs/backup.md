# Managed folder backup (Desktop + Downloads)

Back up your local **Desktop** and **Downloads** folders into one Octo workspace,
foldered by source. It reads your files and uploads changed ones; it **never
deletes, moves, or renames anything locally**, and it stores no credentials — the
token comes from the environment.

```
Desktop/notes.txt            ->  desktop/notes.txt
Desktop/work/proj/deep.txt   ->  desktop/work/proj/deep.txt   (folders preserved)
Downloads/setup.exe          ->  downloads/setup.exe
```

## Start in three steps

**1. Get a workspace ID and an API key.** Open Octo, create (or pick) a workspace,
and mint an API key for it with the `read`, `write`, `files`, and `delete` scopes.
The key is shown once. `delete` is what lets a changed file replace its prior
version instead of leaving a stale copy behind.

**2. Set the two variables.** The source folders already default to your
`Desktop` and `Downloads`, so you only need the token and the workspace:

```bash
# macOS / Linux
export OCTO_BACKUP_TOKEN=octo_live_ws_...
export OCTO_BACKUP_WORKSPACE=<workspace-uuid>

# Windows PowerShell
$env:OCTO_BACKUP_TOKEN = "octo_live_ws_..."
$env:OCTO_BACKUP_WORKSPACE = "<workspace-uuid>"
```

**3. Preview, then run.**

```bash
npm run backup -- --dry-run   # lists what would upload; writes nothing
npm run backup -- --commit    # uploads changed files
```

`--dry-run` never uploads. A run without either flag prints the plan and stops.

## What it does on each run

- **Incremental** — a local manifest records each file's path, size, mtime, and
  SHA-256; unchanged files are skipped, so a re-run uploads only what changed.
- **Replace-on-change** — a changed file is re-uploaded and its prior record is
  deleted, so each backed-up path has exactly one current copy. Without the
  `delete` scope the upload still succeeds but the old copy is left in place and
  reported as `replaceFailed`.
- **Skips** — temp/partial files (`*.crdownload`, `*.part`, `~$*`), empty files,
  files over the size cap, and machine-generated directories (`node_modules`,
  `.git`, `__pycache__`, `.venv`, build caches).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OCTO_BACKUP_TOKEN` | *(required to upload)* | Octo API key |
| `OCTO_BACKUP_WORKSPACE` | *(required to upload)* | Target workspace UUID |
| `OCTO_BACKUP_BASE_URL` | `http://localhost:3001` | Octo server |
| `OCTO_BACKUP_SOURCES` | `Desktop=$HOME/Desktop,Downloads=$HOME/Downloads` | `Name=/path` pairs, comma-separated |
| `OCTO_BACKUP_IGNORE` | `.DS_Store,Thumbs.db,desktop.ini` | Extra bare file names to skip |
| `OCTO_BACKUP_MANIFEST` | `$HOME/.octo/backup-manifest.json` | Incremental state file |
| `OCTO_BACKUP_MAX_MB` | `100` | Skip files larger than this |

## Run it on a schedule

**Windows (Task Scheduler):** create a Basic Task, trigger Daily, action
*Start a program*:

```
Program:   powershell.exe
Arguments: -NoProfile -Command "cd C:\path\to\octo-db; $env:OCTO_BACKUP_TOKEN='...'; $env:OCTO_BACKUP_WORKSPACE='...'; npm run backup -- --commit"
```

**macOS / Linux (cron):** `crontab -e`

```cron
# every day at 09:00
0 9 * * * cd /path/to/octo-db && OCTO_BACKUP_TOKEN=... OCTO_BACKUP_WORKSPACE=... npm run backup -- --commit >> ~/.octo/backup.log 2>&1
```
