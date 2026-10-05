import { useState } from 'react';
import { mediaUrl } from '../lib/supabase';
import { uploadImage, type UploadFolder } from '../lib/upload';

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
  const [busy, setBusy] = useState(false);
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
            setBusy(true);
            setError('');
            try {
              onChange(await uploadImage(file, folder));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Upload failed');
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {value && (
        <button type="button" className="link-btn" onClick={() => onChange(null)}>
          Remove photo
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** Up to `max` images in order; the first one is the cover. */
export function ImageListField({
  label,
  value,
  folder,
  onChange,
  max = 5,
}: {
  label: string;
  value: string[];
  folder: UploadFolder;
  onChange: (keys: string[]) => void;
  max?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="field">
      <label>
        {label} ({value.length}/{max})
      </label>
      <div className="image-strip">
        {value.map((k, i) => (
          <div key={k} className="image-pick small">
            <img src={mediaUrl(k)} alt="" loading="lazy" decoding="async" />
            {i === 0 && <em className="cover-tag">Cover</em>}
            <button
              type="button"
              className="remove"
              aria-label="Remove image"
              onClick={() => onChange(value.filter((x) => x !== k))}
            >
              ×
            </button>
          </div>
        ))}
        {value.length < max && (
          <div className="image-pick small">
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
                setBusy(true);
                setError('');
                try {
                  const keys: string[] = [];
                  for (const f of files) keys.push(await uploadImage(f, folder));
                  onChange([...value, ...keys]);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Upload failed');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
