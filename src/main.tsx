import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles/index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
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
