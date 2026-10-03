import * as React from "react";
import { Film, ImageIcon, Images, PlayCircle } from "lucide-react";
import { PageHeader } from "@v2/components/page-header";
import { EmptyState, ErrorState, LoadingRows, SectionCard } from "@v2/components/feedback";
import { Badge } from "@v2/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@v2/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@v2/components/ui/tabs";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import { useGallery } from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";
import type { GalleryItem } from "@v2/types/octo";
import { formatBytes, formatDate } from "@v2/lib/format";
import { cn } from "@v2/lib/utils";

function MediaCard({ item, onOpen }: { item: GalleryItem; onOpen: (item: GalleryItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden bg-muted">
        <img
          src={item.thumbnailUrl}
          alt={item.name}
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {item.kind === "video" ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/35">
            <PlayCircle className="size-9 text-white/90" />
          </span>
        ) : null}
      </span>
      <span className="flex flex-col gap-1 p-3">
        <span className="truncate text-sm font-medium">{item.name}</span>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{formatBytes(item.sizeBytes)}</span>
          <span>·</span>
          <span>{formatDate(item.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}

export default function GalleryPage() {
  const { activeWorkspace } = useActiveWorkspace();
  const { mode } = useOctoData();
  const workspaceId = activeWorkspace?.id ?? null;
  const demo = mode === "demo";

  const gallery = useGallery(workspaceId);
  const [open, setOpen] = React.useState<GalleryItem | null>(null);

  const items = gallery.data ?? [];
  const images = items.filter((item) => item.kind === "image");
  const videos = items.filter((item) => item.kind === "video");

  return (
    <>
      <PageHeader
        title="Gallery"
        description="Browse actual workspace media. Thumbnails are derivatives; signed URLs can expire, so the view refetches rather than caching URLs indefinitely."
        actions={demo ? <Badge variant="warning">Demo data</Badge> : null}
      />

      <SectionCard
        title="Media"
        description={`${items.length} item(s) in this workspace.`}
      >
        {gallery.isLoading ? (
          <LoadingRows rows={6} />
        ) : gallery.isError ? (
          <ErrorState error={gallery.error} onRetry={() => void gallery.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Images}
            title="No media in this workspace"
            description="Upload an image or a browser-playable video from the Files view and it will appear here."
          />
        ) : (
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">
                <Images className="size-3.5" />
                All ({items.length})
              </TabsTrigger>
              <TabsTrigger value="images">
                <ImageIcon className="size-3.5" />
                Images ({images.length})
              </TabsTrigger>
              <TabsTrigger value="videos">
                <Film className="size-3.5" />
                Video ({videos.length})
              </TabsTrigger>
            </TabsList>

            {(
              [
                ["all", items],
                ["images", images],
                ["videos", videos],
              ] as const
            ).map(([value, list]) => (
              <TabsContent key={value} value={value}>
                {list.length === 0 ? (
                  <EmptyState
                    icon={Images}
                    title="Nothing in this filter"
                    description="Switch tabs or upload matching media."
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                    {list.map((item) => (
                      <MediaCard key={item.id} item={item} onOpen={setOpen} />
                    ))}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </SectionCard>

      <Dialog open={Boolean(open)} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className={cn("max-w-3xl")}>
          <DialogHeader>
            <DialogTitle className="truncate">{open?.name}</DialogTitle>
            <DialogDescription>
              {open?.mimeType} · {open ? formatBytes(open.sizeBytes) : ""} ·{" "}
              {open ? formatDate(open.createdAt) : ""}
            </DialogDescription>
          </DialogHeader>

          {open ? (
            <div className="overflow-hidden rounded-lg border border-border bg-muted">
              {open.kind === "video" ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center">
                  <PlayCircle className="size-10 text-muted-foreground" />
                  <p className="text-sm font-medium">Video playback</p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    The prototype has no real object bytes, so playback needs the live API. The
                    poster below is a generated derivative.
                  </p>
                  <img src={open.fullUrl} alt={open.name} className="mt-2 w-full rounded-md" />
                </div>
              ) : (
                <img src={open.fullUrl} alt={open.name} className="w-full" />
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
