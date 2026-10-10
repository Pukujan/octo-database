import { apiSend } from '@/lib/api';
import { downloadFile } from '@/lib/files';
import { useOcto } from '@/lib/octo';
import { useWorkspace } from '@/lib/workspace';
import type { ActivityRow, FileRecord, GalleryItem } from '@/lib/types';

// The pieces every view reuses: byte/date formatting, file rows, media cards,
// and the activity list. Kept byte-identical to the display strings the
// screenshots and the e2e assertions were written against.

export const bytes = (value: number): string =>
  value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;

export const date = (value?: string | null): string =>
  value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';

export const when = (value?: string | null): string =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '—';

export const statusFor = (archiveState: string): string =>
  archiveState === 'archived_drive'
    ? 'Archived'
    : archiveState === 'archiving' || archiveState === 'restoring'
      ? 'Transitioning'
      : 'Ready';

/** The shell owns the single upload input; a view asks it to open. */
export const openUpload = (): void => {
  window.dispatchEvent(new Event('octo-open-upload'));
};

/** The per-row file verbs, shared by the Overview and Files catalogs. */
function useFileActions() {
  const { workspace, reload } = useWorkspace();
  const wsId = workspace?.id ?? '';
  const query = `?workspaceId=${encodeURIComponent(wsId)}`;
  return {
    download: (file: FileRecord) => downloadFile(wsId, file.id, file.name),
    archive: async (id: string) => {
      await apiSend(`/api/files/${encodeURIComponent(id)}/archive${query}`, 'POST');
      await reload();
    },
    restore: async (id: string) => {
      await apiSend(`/api/files/${encodeURIComponent(id)}/restore${query}`, 'POST');
      await reload();
    },
    remove: async (id: string) => {
      if (!window.confirm('Remove this file from the workspace?')) return;
      await apiSend(`/api/files/${encodeURIComponent(id)}${query}`, 'DELETE');
      await reload();
    },
  };
}

export function FileRows({ files, showActions = true }: { files: FileRecord[]; showActions?: boolean }) {
  const actions = useFileActions();
  if (!files.length) {
    return (
      <tr>
        <td colSpan={showActions ? 5 : 4} className="empty-row">
          {showActions ? 'No files in this workspace yet.' : 'Your first file will show up here.'}
        </td>
      </tr>
    );
  }
  return (
    <>
      {files.map((file) => (
        <tr key={file.id}>
          <td>
            <span className="file-cell">
              <span className="file-mark" aria-hidden="true">
                ↗
              </span>
              <span>
                <strong>{file.name}</strong>
                <small aria-hidden="true">{file.mimeType}</small>
              </span>
            </span>
          </td>
          <td>{bytes(file.sizeBytes)}</td>
          <td>{statusFor(file.archiveState)}</td>
          <td>{date(file.createdAt)}</td>
          {showActions ? (
            <td className="row-actions">
              <button className="text-button" data-action="download" data-id={file.id} onClick={() => void actions.download(file)}>
                Download
              </button>
              {file.archiveState === 'archived_drive' ? (
                <button className="text-button" data-action="restore" data-id={file.id} onClick={() => void actions.restore(file.id)}>
                  Restore
                </button>
              ) : (
                <button className="text-button" data-action="archive" data-id={file.id} onClick={() => void actions.archive(file.id)}>
                  Archive
                </button>
              )}
              <button className="text-button danger" data-action="delete-file" data-id={file.id} onClick={() => void actions.remove(file.id)}>
                Remove
              </button>
            </td>
          ) : null}
        </tr>
      ))}
    </>
  );
}

function MediaGrid({ items, limit, onOpen }: { items: GalleryItem[]; limit?: number; onOpen?: (item: GalleryItem) => void }) {
  const rows = typeof limit === 'number' ? items.slice(0, limit) : items;
  if (!rows.length) {
    return (
      <div className="empty-panel">
        <span className="empty-mark">▧</span>
        <strong>No media yet</strong>
        <p>Images and videos added to this workspace appear here.</p>
      </div>
    );
  }
  return (
    <div className="media-grid">
      {rows.map((item) => (
        <button
          key={item.id}
          className="media-card"
          data-action="preview"
          data-id={item.id}
          aria-label={`Open ${item.name}`}
          onClick={onOpen ? () => onOpen(item) : undefined}
        >
          <img src={item.thumbnailUrl} alt={item.name} loading="lazy" />
          <span className="media-meta">
            <strong>{item.name}</strong>
            <small>{bytes(item.sizeBytes)}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function InteractiveMediaGrid({ items, limit }: { items: GalleryItem[]; limit?: number }) {
  const { openModal, setPreviewItem } = useOcto();
  return (
    <MediaGrid
      items={items}
      limit={limit}
      onOpen={(item) => {
        setPreviewItem(item);
        openModal('preview');
      }}
    />
  );
}

// The public share viewer renders outside OctoProvider, so it asks for the
// non-interactive grid: the cards still render, but no preview modal is wired.
export function MediaCards({ items, limit, interactive = true }: { items: GalleryItem[]; limit?: number; interactive?: boolean }) {
  if (!interactive) return <MediaGrid items={items} limit={limit} />;
  return <InteractiveMediaGrid items={items} limit={limit} />;
}

export function ActivityRows({ items }: { items: ActivityRow[] }) {
  if (!items.length) {
    return (
      <div className="empty-panel compact">
        <strong>No recent activity</strong>
        <p>Workspace events will show here.</p>
      </div>
    );
  }
  return (
    <div className="activity-list">
      {items.slice(0, 5).map((item) => (
        <div className="activity-row" key={item.id}>
          <span className="activity-dot" />
          <span>
            <strong>{item.summary}</strong>
            <small>{item.eventType}</small>
          </span>
          <time>{date(item.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}
