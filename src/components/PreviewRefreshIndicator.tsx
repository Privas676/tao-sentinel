import { useEffect, useState } from "react";

/**
 * Small fixed badge that shows when the app last mounted (i.e., when the
 * preview finished refreshing). Helps confirm a hot-reload or hard refresh
 * actually took effect.
 */
export function PreviewRefreshIndicator() {
  const [mountedAt] = useState(() => new Date());
  const [elapsed, setElapsed] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - mountedAt.getTime()) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [mountedAt]);

  if (hidden) return null;

  const time = mountedAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const fresh = elapsed < 5;

  return (
    <div
      className="fixed bottom-3 right-3 z-[9999] flex items-center gap-2 rounded-md border border-border bg-background/90 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground shadow-lg backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          fresh ? "bg-[hsl(var(--go,142_70%_45%))] animate-pulse" : "bg-muted-foreground/50"
        }`}
        aria-hidden
      />
      <span>Preview updated</span>
      <span className="text-foreground/80">{time}</span>
      <span className="opacity-60">· {elapsed}s ago</span>
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="ml-1 rounded px-1 text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground"
        aria-label="Hide preview indicator"
      >
        ×
      </button>
    </div>
  );
}
