import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

type Phase = "retrying" | "success" | "failed";

interface RetryStatus {
  phase: Phase;
  url: string;
  status?: number;
  attempt: number;
  max: number;
}

/**
 * On-screen indicator that listens for messages broadcast by the retry
 * service worker (`public/sw-retry.js`) and shows the current retry
 * attempt. Hides automatically after success/failure.
 */
export function SwRetryIndicator() {
  const [status, setStatus] = useState<RetryStatus | null>(null);

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

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[9999] -translate-x-1/2"
    >
      <div
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-wide shadow-lg backdrop-blur-md ${tone}`}
      >
        {icon}
        <span className="font-mono uppercase">{label}</span>
        <span className="hidden font-mono text-[10px] opacity-60 sm:inline">
          {shortUrl}
        </span>
      </div>
    </div>
  );
}
