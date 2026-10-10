import { FileRows, openUpload } from '@/components/shared';
import { useOcto } from '@/lib/octo';
import { useWorkspace } from '@/lib/workspace';

export default function Files() {
  const { openModal } = useOcto();
  const { workspace, files } = useWorkspace();

  return (
    <div data-testid="view-files">
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">WORKSPACE CONTENT</p>
            <h2>File Catalog</h2>
            <p className="panel-copy">Upload and manage the files in {workspace?.name}.</p>
          </div>
          <div className="inline-actions">
            <button className="button secondary" data-action="new-text" type="button" onClick={() => openModal('text-file')}>
              New text file
            </button>
            <button className="button primary" data-action="open-upload" type="button" onClick={openUpload}>
              Upload files
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Status</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <FileRows files={files} />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
