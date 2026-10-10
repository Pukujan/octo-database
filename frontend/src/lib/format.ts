// Small display helpers. Numeric values may be null — render "—", never "NaN".

export const DASH = '—';

export function orDash(value: unknown): string {
  if (value === null || value === undefined || value === '') return DASH;
  return String(value);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return DASH;
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "2 hours ago" style, falling back to a date for anything older than a week. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return formatDate(value);
}

/** A share is active when it is neither revoked nor past its expiry. */
export function shareIsActive(share: { revokedAt: string | null; validUntil: string | null }): boolean {
  if (share.revokedAt) return false;
  if (share.validUntil && new Date(share.validUntil).getTime() <= Date.now()) return false;
  return true;
}

export function statusForArchiveState(state: string | null | undefined): string {
  if (state === 'archived_drive') return 'Archived';
  if (state === 'archiving' || state === 'restoring') return 'Transitioning';
  return 'Ready';
}
