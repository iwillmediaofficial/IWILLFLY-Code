import { useEffect, useId, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';

/** A friendly reason the camera could not start. html5-qrcode rejects with strings as well as errors. */
function cameraMessage(e: unknown) {
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/NotAllowed|Permission|denied/i.test(text)) {
    return 'Camera permission was denied. Allow camera access for this site in your browser settings, or type the code below.';
  }
  if (/NotFound|not found|no camera|OverconstrainedError/i.test(text)) {
    return 'No camera was found on this device. Type the code below instead.';
  }
  if (/NotReadable|in use|TrackStart/i.test(text)) {
    return 'The camera is being used by another app. Close it and try again, or type the code below.';
  }
  return 'The camera could not start. Type the code below instead.';
}

const cameraSupported = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;

/**
 * Rear-camera QR scanner. The scanning library is loaded only when this mounts. The camera stops after the
 * first successful read and when the component unmounts.
 */
export default function QrScanner({
  onScan,
  onUnavailable,
}: {
  onScan: (text: string) => void;
  onUnavailable: (message: string) => void;
}) {
  const elementId = `qr-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [starting, setStarting] = useState(true);
  const onScanRef = useRef(onScan);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onScanRef.current = onScan;
    onUnavailableRef.current = onUnavailable;
  });

  useEffect(() => {
    let cancelled = false;
    let read = false;
    let scanner: Html5Qrcode | null = null;

    const stop = async () => {
      const s = scanner;
      // While start() is still pending isScanning is false; the start handler stops it once it resolves.
      if (!s?.isScanning) return;
      try {
        await s.stop();
        s.clear();
      } catch {
        // already stopped
      }
    };

    if (!cameraSupported()) {
      // Report after the effect, not during it.
      queueMicrotask(() => {
        if (!cancelled)
          onUnavailableRef.current('This browser cannot open the camera here. Type the code below instead.');
      });
      return () => {
        cancelled = true;
      };
    }

    import('html5-qrcode')
      .then(async ({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
        if (cancelled) return;
        scanner = new Html5Qrcode(elementId, {
          verbose: false,
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        });
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (w, h) => {
              const side = Math.max(160, Math.floor(Math.min(w, h) * 0.7));
              return { width: side, height: side };
            },
          },
          (text) => {
            if (read) return;
            read = true;
            void stop();
            onScanRef.current(text);
          },
          () => {
            // no code in this frame; keep looking
          },
        );
        if (cancelled) void stop();
        else setStarting(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        void stop();
        onUnavailableRef.current(cameraMessage(e));
      });

    return () => {
      cancelled = true;
      void stop();
    };
  }, [elementId]);

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 18,
        overflow: 'hidden',
        background: '#0f1a2e',
        minHeight: 260,
      }}
    >
      <div id={elementId} style={{ width: '100%' }} />
      {starting && (
        <p
          className="meta"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            margin: 0,
            padding: 16,
            textAlign: 'center',
          }}
        >
          Starting camera… allow camera access if your phone asks.
        </p>
      )}
    </div>
  );
}
