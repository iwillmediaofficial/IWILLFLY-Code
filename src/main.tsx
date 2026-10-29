import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { reloadForNewVersion } from './lib/chunkReload';
import './styles/index.css';

// Vite reports a page file it could not preload here; reload onto the new version instead of throwing.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);

// The offline copy kept phones on an old version after a deploy. Check for a new one on start and whenever
// the app comes back to the front; once it is installed the page reloads onto it.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, reg) {
    if (!reg) return;
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', check);
    setInterval(check, 30 * 60_000);
  },
});
