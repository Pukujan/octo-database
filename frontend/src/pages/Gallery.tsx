import { MediaCards, openUpload } from '@/components/shared';
import { useWorkspace } from '@/lib/workspace';

export default function Gallery() {
  const { gallery } = useWorkspace();

  return (
    <div data-testid="view-gallery">
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">VISUAL LIBRARY</p>
            <h2>Gallery</h2>
            <p className="panel-copy">{gallery.length} images and videos in this workspace.</p>
          </div>
          <button className="button primary" data-action="open-upload" type="button" onClick={openUpload}>
            Add media
          </button>
        </div>
        <div data-testid="gallery-grid">
          <MediaCards items={gallery} />
        </div>
      </section>
    </div>
  );
}
