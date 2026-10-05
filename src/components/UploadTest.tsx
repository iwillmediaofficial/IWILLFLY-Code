import { useState } from 'react';
import { mediaUrl } from '../lib/supabase';
import { uploadImage } from '../lib/upload';

/** Phase 0 check that R2 uploads work end to end. */
export function UploadTest() {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <section className="section form-card">
      <h3 style={{ marginTop: 0 }}>Image upload test</h3>
      <p className="meta">
        Pick a photo. It is converted to WebP on this device and stored in Cloudflare R2.
      </p>
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setError('');
          try {
            setKey(await uploadImage(file, 'test'));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy && <p className="meta">Uploading…</p>}
      {error && <p className="error-text">{error}</p>}
      {key && (
        <img
          src={mediaUrl(key)}
          alt="Uploaded"
          style={{ marginTop: 12, width: '100%', borderRadius: 14, display: 'block' }}
        />
      )}
    </section>
  );
}
