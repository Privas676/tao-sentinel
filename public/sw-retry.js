/* ════════════════════════════════════════════════════════════ */
/*   Retry Service Worker                                       */
/*   Intercepts navigations + fetch and retries 502/503/504     */
/*   responses with exponential backoff.                        */
/*                                                              */
/*   IMPORTANT: A SW cannot intercept the very first document   */
/*   load — that is handled by the upstream proxy. This SW      */
/*   only kicks in for subsequent navigations & fetches once    */
/*   the app has been loaded at least once.                     */
/* ════════════════════════════════════════════════════════════ */

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

self.addEventListener("install", (event) => {
  // Activate immediately on first install.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  // Take control of open clients without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  // attempt is 0-indexed: 500, 1000, 2000, 4000, 8000 (capped)
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * Broadcast a status update to all controlled clients so the UI can
 * render an on-screen retry indicator.
 */
async function broadcast(message) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "SW_RETRY_STATUS", ...message });
    }
  } catch {
    // ignore — broadcast is best-effort
  }
}

/**
 * Fetch with retry + exponential backoff for transient gateway errors.
 * Clones the request so the body stream can be replayed across attempts.
 */
async function fetchWithRetry(request) {
  let lastResponse = null;
  let lastError = null;
  const url = request.url;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const reqClone = request.clone();
      const response = await fetch(reqClone);

      if (!RETRYABLE_STATUSES.has(response.status)) {
        if (attempt > 0) {
          broadcast({ phase: "success", url, attempt: attempt + 1, max: MAX_ATTEMPTS });
        }
        return response;
      }

      lastResponse = response;
      console.warn(
        `[sw-retry] ${response.status} on ${url} — attempt ${attempt + 1}/${MAX_ATTEMPTS}`,
      );
      broadcast({
        phase: "retrying",
        url,
        status: response.status,
        attempt: attempt + 1,
        max: MAX_ATTEMPTS,
      });
    } catch (err) {
      lastError = err;
      console.warn(
        `[sw-retry] network error on ${url} — attempt ${attempt + 1}/${MAX_ATTEMPTS}`,
        err,
      );
      broadcast({
        phase: "retrying",
        url,
        status: 0,
        attempt: attempt + 1,
        max: MAX_ATTEMPTS,
      });
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(backoffDelay(attempt));
    }
  }

  broadcast({ phase: "failed", url, attempt: MAX_ATTEMPTS, max: MAX_ATTEMPTS });
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("[sw-retry] exhausted retries");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only intercept GET (safe to retry) and navigations.
  // POST/PUT/PATCH/DELETE are NOT retried automatically — replaying a
  // mutation is unsafe without idempotency guarantees.
  const isNavigation = request.mode === "navigate";
  const isSafeGet = request.method === "GET";

  if (!isNavigation && !isSafeGet) return;

  // Skip cross-origin requests we don't control (auth providers, CDNs).
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetchWithRetry(request));
});
