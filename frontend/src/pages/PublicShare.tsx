import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicGet } from '@/lib/api';
import { MediaCards, date } from '@/components/shared';
import type { PublicShare } from '@/lib/types';

// The read-only view a share link opens to. It is anonymous: no token, no
// session, and the same media grid the workspace uses.

export default function PublicShare() {
  const { token = '' } = useParams();
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [data, setData] = useState<PublicShare | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    publicGet<PublicShare>(`/api/public/shares/${encodeURIComponent(token)}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="public-shell" data-testid="public-share-viewer">
      <div className="public-head">
        <a className="brand-lockup" href="/">
          <span className="brand-mark">◉</span>
          <span>octo</span>
        </a>
        <span className="public-badge">Shared gallery</span>
      </div>
      <section className="public-content">
        <p className="eyebrow">READ ONLY</p>
        <h1>🐙 Shared Album</h1>
        <p className="muted">Read-only view of a single shared album.</p>
        <div className="public-state">
          {state === 'loading' ? <span>Loading shared album…</span> : null}
          {state === 'unavailable' ? (
            <div className="empty-panel">
              <strong>This link is not available</strong>
              <p>It may have been revoked, expired, or never existed.</p>
            </div>
          ) : null}
          {state === 'ready' && data ? (
            <>
              <div className="share-meta">
                <span>Permission: {data.share.permission}</span>
                <span>{data.share.validUntil ? `Expires ${date(data.share.validUntil)}` : 'No expiry (revocable)'}</span>
              </div>
              <MediaCards items={data.items} interactive={false} />
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
