import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCw, Loader2 } from "lucide-react";

const HEALTH_CHECK_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const FAILURES_BEFORE_BANNER = 2;
const CALM_MODE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const CALM_MODE_STORAGE_KEY = "proxy_recovery_last_shown_at";

type Reason = "health-check" | "sw-failed";

/**
 * "Calme-toi" mode: prevents the banner from re-appearing more than once
 * every CALM_MODE_COOLDOWN_MS. Persisted in localStorage so it survives
 * reloads (which is exactly what we need after a failed recovery attempt).
 */
function canShowBanner(): boolean {
  try {
    const raw = localStorage.getItem(CALM_MODE_STORAGE_KEY);
    if (!raw) return true;
    const last = Number.parseInt(raw, 10);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= CALM_MODE_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markBannerShown(): void {
  try {
    localStorage.setItem(CALM_MODE_STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore (private mode, quota, etc.)
  }
}

/**
 * Detects when the dev/proxy server has gone unresponsive (502/503/504 or
 * network failures) on background pings, OR when the retry SW signals it
 * has exhausted retries. Shows a recovery banner with a button that:
 *  - unregisters service workers
 *  - clears caches + sessionStorage flags
 *  - hard-reloads on the current route
 *
 * Cannot help when the very first document load returns 502 — that page
 * is served by the upstream proxy before any JS runs.
 */
export function ProxyRecoveryBanner() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);
  const [recovering, setRecovering] = useState(false);
  const failureCountRef = useRef(0);

  // Background health check — detects server outages between user actions.
  useEffect(() => {
    let cancelled = false;

    async function ping() {
      if (cancelled) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
      try {
        const res = await fetch(`/?__health=${Date.now()}`, {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (cancelled) return;

        const isGatewayDown = res.status === 502 || res.status === 503 || res.status === 504;
        if (isGatewayDown) {
          failureCountRef.current += 1;
          if (failureCountRef.current >= FAILURES_BEFORE_BANNER) {
            setReason("health-check");
            setOpen(true);
          }
        } else {
          failureCountRef.current = 0;
          // Only auto-dismiss if we opened due to health check, not SW failure.
          setOpen((prev) => (prev && reason === "health-check" ? false : prev));
        }
      } catch {
        clearTimeout(timer);
        if (cancelled) return;
        failureCountRef.current += 1;
        if (failureCountRef.current >= FAILURES_BEFORE_BANNER) {
          setReason("health-check");
          setOpen(true);
        }
      }
    }

    const id = setInterval(ping, HEALTH_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [reason]);

  // Listen for SW exhaustion events.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || data.type !== "SW_RETRY_STATUS") return;
      if (data.phase === "failed") {
        setReason("sw-failed");
        setOpen(true);
      }
    }

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  async function recover() {
    setRecovering(true);
    const target =
      window.location.pathname + window.location.search + window.location.hash;

    try {
      // 1. Unregister all service workers so a stale SW can't keep serving
      //    cached/failed responses.
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
      }

      // 2. Purge all CacheStorage entries.
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
      }

      // 3. Clear session-scoped reload guards so the next boot is clean.
      try {
        sessionStorage.removeItem("sw_reloaded");
      } catch {
        // ignore
      }
    } catch (err) {
      console.warn("[recovery] cleanup failed:", err);
    } finally {
      // 4. Hard-reload on the current route. Using assign() guarantees we
      //    land exactly where the user was, even if the proxy currently
      //    shows an error page on a different URL.
      window.location.assign(target);
    }
  }

  if (!open) return null;

  const title =
    reason === "sw-failed"
      ? "Le serveur ne répond plus après plusieurs tentatives"
      : "Connexion au serveur perdue";
  const description =
    reason === "sw-failed"
      ? "Le retry automatique a épuisé ses tentatives. Une récupération manuelle peut relancer la session."
      : "Le serveur de prévisualisation renvoie des erreurs 502/503. Tu peux tenter une récupération complète.";

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="proxy-recovery-title"
      className="fixed inset-x-3 bottom-3 z-[10000] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm"
    >
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 shadow-2xl backdrop-blur-md">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p
              id="proxy-recovery-title"
              className="font-mono text-[11px] font-semibold uppercase tracking-wide text-red-100"
            >
              {title}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-red-200/80">
              {description}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={recover}
                disabled={recovering}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 bg-red-400/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-red-50 transition-colors hover:bg-red-400/30 focus:outline-none focus:ring-1 focus:ring-red-300 disabled:opacity-60"
              >
                {recovering ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <RotateCw className="h-3 w-3" aria-hidden />
                )}
                {recovering ? "Récupération…" : "Récupérer la session"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={recovering}
                className="font-mono text-[10px] uppercase tracking-wide text-red-200/70 hover:text-red-100 disabled:opacity-60"
              >
                Ignorer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
