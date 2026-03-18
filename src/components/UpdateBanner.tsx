import { useState, useEffect } from "react";

export function UpdateBanner() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleControllerChange = () => {
      // New SW took control — reload handled by main.tsx
    };

    const checkWaiting = async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      const onStateChange = (sw: ServiceWorker) => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(sw);
          setShowUpdate(true);
        }
      };

      if (reg.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(reg.waiting);
        setShowUpdate(true);
      }

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener("statechange", () => onStateChange(newWorker));
        }
      });
    };

    checkWaiting();
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }
    window.location.reload();
  };

  if (!showUpdate) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl px-4 py-2.5 shadow-lg animate-in slide-in-from-bottom-4 duration-500"
      style={{
        background: "hsla(0,0%,8%,0.95)",
        border: "1px solid hsla(0,0%,100%,0.08)",
        backdropFilter: "blur(16px)",
      }}
    >
      <span className="text-sm">🔄</span>
      <span className="font-mono text-[10px] tracking-wide text-muted-foreground">
        Nouvelle version disponible
      </span>
      <button
        onClick={handleUpdate}
        className="font-mono text-[10px] font-semibold tracking-wider px-3 py-1 rounded-md transition-colors"
        style={{
          background: "hsla(var(--gold), 0.12)",
          color: "hsl(var(--gold))",
          border: "1px solid hsla(var(--gold), 0.2)",
        }}
      >
        Mettre à jour
      </button>
      <button
        onClick={() => setShowUpdate(false)}
        className="text-muted-foreground/40 hover:text-muted-foreground transition-colors text-xs ml-1"
      >
        ✕
      </button>
    </div>
  );
}
