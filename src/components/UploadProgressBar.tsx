import type { UploadProgress } from '../lib/upload';

/**
 * A thin bar with a short label while an image is being shrunk and sent, e.g. "Uploading… 45%".
 * `count` adds "2 of 3" for fields that take several images at once.
 */
export function UploadProgressBar({
  progress,
  count,
}: {
  progress: UploadProgress;
  count?: { current: number; total: number };
}) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const of = count && count.total > 1 ? ` ${count.current} of ${count.total}` : '';
  const label = progress.stage === 'preparing' ? `Preparing${of}…` : `Uploading${of}… ${percent}%`;
  return (
    <div className="upload-progress">
      <div
        className="upload-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className={progress.stage} style={{ width: `${percent}%` }} />
      </div>
      <div className="upload-progress-label">{label}</div>
    </div>
  );
}
