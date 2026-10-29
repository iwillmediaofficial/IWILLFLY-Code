// After a deploy the old page files are gone, so a page left open (or an old offline copy) can fail to load the
// next screen it opens. Reloading once fetches the new version. The timestamp stops a reload loop if that fails too.
const KEY = 'iwf-chunk-reload';
const WINDOW_MS = 10_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|ChunkLoadError/i.test(
    message,
  );
}

/** Reloads the page unless it already did so in the last few seconds. Returns whether it is reloading. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY));
    if (last && Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No storage (private mode, blocked): reloading without a guard could loop, so show the error screen instead.
    return false;
  }
  window.location.reload();
  return true;
}
