import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2, EyeOff, Eye } from "lucide-react";

type Phase = "retrying" | "success" | "failed";

interface RetryStatus {
  phase: Phase;
  url: string;
  status?: number;
  attempt: number;
  max: number;
}

const HIDE_ON_SCROLL_KEY = "sw_retry_hide_on_scroll";
const SCROLL_RESUME_DELAY_MS = 600;

function readHideOnScroll(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(HIDE_ON_SCROLL_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHideOnScroll(value: boolean) {
  try {
    localStorage.setItem(HIDE_ON_SCROLL_KEY, value ? "1" : "0");
  } catch {
    // ignore quota / privacy errors
  }
}

/**
 * On-screen indicator that listens for messages broadcast by the retry
 * service worker (`public/sw-retry.js`) and shows the current retry
 * attempt. Hides automatically after success/failure.
 *
 * Includes an opt-in "auto-hide while scrolling" toggle (persisted in
 * localStorage) so the badge doesn't distract the user during retries.
 */
export function SwRetryIndicator() {
  const [status, setStatus] = useState<RetryStatus | null>(null);
  const [hideOnScroll, setHideOnScroll] = useState<boolean>(() => readHideOnScroll());
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for SW retry status messages.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || data.type !== "SW_RETRY_STATUS") return;

      const next: RetryStatus = {
        phase: data.phase,
        url: data.url,
        status: data.status,
        attempt: data.attempt,
        max: data.max,
      };

      setStatus(next);

      if (hideTimer) clearTimeout(hideTimer);
      if (next.phase === "success") {
        hideTimer = setTimeout(() => setStatus(null), 2000);
      } else if (next.phase === "failed") {
        hideTimer = setTimeout(() => setStatus(null), 5000);
      }
    }

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  // Track scroll only when the auto-hide toggle is on.
  useEffect(() => {
    if (!hideOnScroll) {
      setIsScrolling(false);
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
      return;
    }

    function onScroll() {
      setIsScrolling(true);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, SCROLL_RESUME_DELAY_MS);
    }

    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, [hideOnScroll]);

  function toggleHideOnScroll() {
    setHideOnScroll((prev) => {
      const next = !prev;
      writeHideOnScroll(next);
      return next;
    });
  }

  if (!status) return null;

  const shortUrl = (() => {
    try {
      const u = new URL(status.url);
      return u.pathname.length > 32 ? `…${u.pathname.slice(-30)}` : u.pathname;
    } catch {
      return status.url;
    }
  })();

  const icon =
    status.phase === "retrying" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
    ) : status.phase === "success" ? (
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
    ) : (
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
    );

  const label =
    status.phase === "retrying"
      ? `Reconnexion ${status.attempt}/${status.max}${
          status.status ? ` · ${status.status}` : ""
        }`
      : status.phase === "success"
        ? "Connexion rétablie"
        : `Échec après ${status.max} tentatives`;

  const tone =
    status.phase === "retrying"
      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-200"
      : status.phase === "success"
        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
        : "border-red-500/40 bg-red-500/10 text-red-200";

  // While scrolling (and toggle is on), fade out but keep aria-live for SR.
  const hidden = hideOnScroll && isScrolling;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-1/2 z-[9999] -translate-x-1/2 transition-opacity duration-200 ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-wide shadow-lg backdrop-blur-md ${tone}`}
      >
        {icon}
        <span className="font-mono uppercase">{label}</span>
        <span className="hidden font-mono text-[10px] opacity-60 sm:inline">
          {shortUrl}
        </span>
        <button
          type="button"
          onClick={toggleHideOnScroll}
          aria-pressed={hideOnScroll}
          aria-label={
            hideOnScroll
              ? "Désactiver le masquage au défilement"
              : "Masquer pendant le défilement"
          }
          title={
            hideOnScroll
              ? "Masquage au défilement : activé"
              : "Masquage au défilement : désactivé"
          }
          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-current/20 opacity-60 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none"
        >
          {hideOnScroll ? (
            <EyeOff className="h-3 w-3" aria-hidden />
          ) : (
            <Eye className="h-3 w-3" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
