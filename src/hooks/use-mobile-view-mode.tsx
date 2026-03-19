import { useState, useCallback } from "react";

export type MobileViewMode = "cards" | "table";

const STORAGE_KEY = "mobile-view-mode-v1";

function loadMode(): MobileViewMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "cards" || saved === "table") return saved;
  } catch {}
  return "cards";
}

export function useMobileViewMode() {
  const [mode, setModeState] = useState<MobileViewMode>(loadMode);

  const setMode = useCallback((m: MobileViewMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }, []);

  const toggle = useCallback(() => {
    setModeState(prev => {
      const next = prev === "cards" ? "table" : "cards";
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      return next;
    });
  }, []);

  return { mode, setMode, toggle };
}
