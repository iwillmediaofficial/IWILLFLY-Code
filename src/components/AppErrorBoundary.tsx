import { Component, type ReactNode } from 'react';
import { isChunkLoadError, reloadForNewVersion } from '../lib/chunkReload';
import { PageLoader } from './PageLoader';

/**
 * Catches anything that would otherwise unmount the whole app and leave a white screen.
 * A page file missing after a deploy reloads onto the new version once; anything else shows a Reload screen.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; reloading: boolean }
> {
  state = { failed: false, reloading: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
    if (isChunkLoadError(error) && reloadForNewVersion()) this.setState({ reloading: true });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.reloading) return <PageLoader />;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          background: '#f4f7fb',
          fontFamily: 'Inter, system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <img src="/iwillfly-logo.webp" alt="IWILLFLY" width={200} height={65} />
        <p style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#0f172a' }}>Something went wrong</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            border: 0,
            borderRadius: 12,
            padding: '12px 28px',
            background: '#1760d9',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
