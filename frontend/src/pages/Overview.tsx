import { ActivityRows, FileRows, MediaCards, bytes, openUpload } from '@/components/shared';
import { useOcto } from '@/lib/octo';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';

export default function Overview() {
  const { setView, openModal } = useOcto();
  const { principal } = useSession();
  const { workspace, files, gallery, jobs, activity } = useWorkspace();
  const used = files.reduce((sum, file) => sum + (file.sizeBytes || 0), 0);
  const failed = jobs.filter((job) => job.state === 'failed').length;

  return (
    <div data-testid="view-overview">
      <section className="welcome-panel">
        <div>
          <p className="eyebrow">
            {`${(workspace?.role ?? 'Workspace').toUpperCase()} WORKSPACE`}
            {principal?.isGuest ? ' · GUEST SANDBOX' : ''}
          </p>
          <h2>Workspace overview</h2>
          <p>{workspace?.description || 'Your files, media, and workspace activity in one place.'}</p>
        </div>
        <div className="welcome-actions">
          <button className="button primary" data-action="open-upload" type="button" onClick={openUpload}>
            Upload files
          </button>
          <button className="button secondary" data-action="new-text" type="button" onClick={() => openModal('text-file')}>
            New text file
          </button>
        </div>
      </section>

      <div className="metric-grid">
        <article className="metric-card">
          <span className="metric-label">Recorded storage</span>
          <strong>{bytes(used)}</strong>
          <small>From active file records</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">Files</span>
          <strong>{files.length}</strong>
          <small>Catalogued in this workspace</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">Media</span>
          <strong>{gallery.length}</strong>
          <small>Images and videos</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">Failed jobs</span>
          <strong className={failed ? 'metric-warning' : ''}>{failed}</strong>
          <small>Recent operations</small>
        </article>
      </div>

      <div className="content-grid">
        <section className="panel panel-wide">
          <div className="panel-head">
            <div>
              <p className="eyebrow">YOUR DATA</p>
              <h2>File Catalog</h2>
            </div>
            <button className="text-button" data-view="files" type="button" onClick={() => setView('files')}>
              View all files →
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                <FileRows files={files.slice(0, 5)} showActions={false} />
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">WORKSPACE MEDIA</p>
              <h2>Gallery</h2>
            </div>
            <button className="text-button" data-view="gallery" type="button" onClick={() => setView('gallery')}>
              Browse →
            </button>
          </div>
          <MediaCards items={gallery} limit={3} />
        </section>
      </div>

      <section className="panel activity-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">LATEST</p>
            <h2>Recent activity</h2>
          </div>
          <button className="text-button" data-view="operations" type="button" onClick={() => setView('operations')}>
            Operations →
          </button>
        </div>
        <ActivityRows items={activity.slice(0, 3)} />
      </section>
    </div>
  );
}
