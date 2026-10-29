import { useRef, useState, type ReactNode } from 'react';
import { UploadProgressBar } from '../components/UploadProgressBar';
import { mediaUrl } from '../lib/supabase';
import { uploadImage, type UploadFolder, type UploadProgress } from '../lib/upload';

/**
 * A square picture (category, district): preview plus Upload / Replace / Remove. Uploads are centre-cropped on
 * the device to 512 x 512 WebP, so any photo works.
 */
export function SquareImageField({
  value,
  onChange,
  icon,
  folder,
  alt,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  /** Shown when there is no picture */
  icon: ReactNode;
  folder: UploadFolder;
  alt: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // null when no upload is running.
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const busy = progress !== null;
  const [error, setError] = useState('');

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setProgress({ stage: 'preparing', percent: 0 });
    setError('');
    try {
      onChange(await uploadImage(file, folder, { square: 512, onProgress: setProgress }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="field">
      <label>Picture (square)</label>
      <div className="cat-image-field">
        <div className="cat-image-preview">
          {value ? <img src={mediaUrl(value)} alt={alt} width={96} height={96} /> : <span>{icon}</span>}
          {busy && <div className="cat-image-busy">Uploading…</div>}
        </div>
        <div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {value ? 'Replace' : '＋ Upload picture'}
            </button>
            {value && (
              <button
                type="button"
                className="btn small danger"
                disabled={busy}
                onClick={() => onChange(null)}
              >
                Remove
              </button>
            )}
          </div>
          <div className="hint">
            Any photo works: we crop the centre to a square (512 × 512). Without a picture, a line icon is
            shown.
          </div>
          {progress && <UploadProgressBar progress={progress} />}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void pick(file);
        }}
      />
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
