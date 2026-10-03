import * as React from "react";
import { useParams } from "react-router-dom";
import { Images, Lock, ShieldCheck } from "lucide-react";
import { ThemeSwitcher } from "@v2/components/layout/theme-switcher";
import { EmptyState } from "@v2/components/feedback";
import { Badge } from "@v2/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@v2/components/ui/dialog";
import { buildDemoGallery } from "@v2/data/fixtures";
import { useOctoData } from "@v2/data/provider";
import type { GalleryItem } from "@v2/types/octo";
import { formatBytes, formatDate } from "@v2/lib/format";

/**
 * Standalone public viewer for `/share/<token>`.
 *
 * It has no session, no workspace switcher, and no admin surface. Only the
 * shared target is reachable; workspace, member, key and admin routes stay
 * unreachable from here.
 */
export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { mode } = useOctoData();
  const [open, setOpen] = React.useState<GalleryItem | null>(null);

  const demoItems = React.useMemo(() => buildDemoGallery("share-preview", 8), []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
            <svg viewBox="0 0 64 64" className="size-5" aria-hidden="true">
              <path
                d="M32 14c-10 0-18 7-18 16 0 6 3 10 9 13l-4 11 10-6h6l10 6-4-11c6-3 9-7 9-13 0-9-8-16-18-16Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinejoin="round"
                className="text-primary"
              />
            </svg>
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold">Octo</span>
            <span className="text-[11px] text-muted-foreground">Shared gallery</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline">
              <Lock className="size-3" />
              read-only
            </Badge>
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Shared album</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Token <code className="font-mono text-xs">{token?.slice(0, 12) ?? "—"}…</code> grants
            read-only access to exactly this album. Possession of the token is the capability; no
            session is created and no other workspace surface is reachable.
          </p>
        </div>

        {mode === "live" ? (
          <EmptyState
            icon={ShieldCheck}
            title="Resolve this link against the server"
            description="The standalone viewer fetches the shared target through the server share route. Switch the data source to Demo fixtures to preview the album layout."
          />
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-xs">
              <Badge variant="warning">Demo data</Badge>
              <span className="text-muted-foreground">
                Illustrative album used to preview the share layout.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {demoItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setOpen(item)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block aspect-[4/3] w-full overflow-hidden bg-muted">
                    <img
                      src={item.thumbnailUrl}
                      alt={item.name}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </span>
                  <span className="flex flex-col gap-1 p-3">
                    <span className="truncate text-sm font-medium">{item.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatBytes(item.sizeBytes)} · {formatDate(item.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
          <Images className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Signed media URLs expire. Revoking or expiring the share also invalidates the media it
            served, so a stale URL is not a bypass.
          </span>
        </div>
      </main>

      <Dialog open={Boolean(open)} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{open?.name}</DialogTitle>
          </DialogHeader>
          {open ? <img src={open.fullUrl} alt={open.name} className="w-full rounded-lg" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
