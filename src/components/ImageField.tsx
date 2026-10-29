import { useState } from 'react';
import { mediaUrl } from '../lib/supabase';
import {
  checkPickedSize,
  uploadImage,
  type PosterFrame,
  type UploadFolder,
  type UploadProgress,
} from '../lib/upload';
import { usePosterCrop } from './usePosterCrop';
import { UploadProgressBar } from './UploadProgressBar';
import { X } from 'lucide-react';
import { Icon } from './Icon';

/** One image: shows the current picture and uploads a replacement to R2 (WebP). */
export function ImageField({
  label,
  value,
  folder,
  onChange,
  aspect = '1 / 1',
}: {
  label: string;
  value: string | null;
  folder: UploadFolder;
  onChange: (key: string | null) => void;
  aspect?: string;
}) {
  // null when no upload is running.
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const busy = progress !== null;
  const [error, setError] = useState('');
  return (
    <div className="field">
      <label>{label}</label>
      <div className="image-pick" style={{ aspectRatio: aspect }}>
        {value ? (
          <img src={mediaUrl(value)} alt="" decoding="async" />
        ) : (
          <span>{busy ? 'Uploading…' : '＋ Add photo'}</span>
        )}
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          aria-label={label}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setProgress({ stage: 'preparing', percent: 0 });
            setError('');
            try {
              onChange(await uploadImage(file, folder, { onProgress: setProgress }));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Upload failed');
            } finally {
              setProgress(null);
            }
          }}
        />
      </div>
      {progress && <UploadProgressBar progress={progress} />}
      {value && (
        <button type="button" className="link-btn" onClick={() => onChange(null)}>
          Remove photo
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/**
 * Up to `max` images in order; the first one is the cover. With `poster`, each picture is saved as a 4:5
 * 1080 x 1350 poster, through a crop screen when it is not 4:5 already.
 */
export function ImageListField({
  label,
  value,
  folder,
  onChange,
  max = 5,
  poster = false,
}: {
  label: string;
  value: string[];
  folder: UploadFolder;
  onChange: (keys: string[]) => void;
  max?: number;
  poster?: boolean;
}) {
  const crop = usePosterCrop();
  const thumb = `image-pick small${poster ? ' poster' : ''}`;
  // The running upload, with which of the picked files it is; null when idle.
  const [upload, setUpload] = useState<{ progress: UploadProgress; current: number; total: number } | null>(
    null,
  );
  const busy = upload !== null;
  const [error, setError] = useState('');
  return (
    <div className="field">
      <label>
        {label} ({value.length}/{max})
      </label>
      {poster && (
        <p className="meta" style={{ margin: '0 0 6px' }}>
          Best size 1080 × 1350 (4:5, Instagram post). Other shapes can be cropped or fitted whole.
        </p>
      )}
      <div className="image-strip">
        {value.map((k, i) => (
          <div key={k} className={thumb}>
            <img src={mediaUrl(k)} alt="" loading="lazy" decoding="async" />
            {i === 0 && <em className="cover-tag">Cover</em>}
            <button
              type="button"
              className="remove"
              aria-label="Remove image"
              onClick={() => onChange(value.filter((x) => x !== k))}
            >
              <Icon icon={X} />
            </button>
          </div>
        ))}
        {value.length < max && (
          <div className={thumb}>
            <span>{busy ? '…' : '＋'}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              aria-label={`Add ${label}`}
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []).slice(0, max - value.length);
                e.target.value = '';
                if (!files.length) return;
                setError('');
                try {
                  const keys: string[] = [];
                  for (const [i, f] of files.entries()) {
                    const step = { current: i + 1, total: files.length };
                    let frame: PosterFrame | undefined;
                    if (poster) {
                      checkPickedSize(f);
                      frame =
                        (await crop.ask(
                          f,
                          files.length > 1 ? `Fit picture ${i + 1} of ${files.length}` : undefined,
                        )) ?? undefined;
                      // Cancel skips this picture; the others still go up.
                      if (!frame) continue;
                    }
                    setUpload({ progress: { stage: 'preparing', percent: 0 }, ...step });
                    keys.push(
                      await uploadImage(f, folder, {
                        poster: frame,
                        onProgress: (progress) => setUpload({ progress, ...step }),
                      }),
                    );
                  }
                  if (keys.length) onChange([...value, ...keys]);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Upload failed');
                } finally {
                  setUpload(null);
                }
              }}
            />
          </div>
        )}
      </div>
      {upload && (
        <UploadProgressBar
          progress={upload.progress}
          count={{ current: upload.current, total: upload.total }}
        />
      )}
      {error && <p className="error-text">{error}</p>}
      {crop.element}
    </div>
  );
}
