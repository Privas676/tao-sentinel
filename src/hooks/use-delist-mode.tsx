import { useState, useEffect, useCallback } from "react";
import type { DelistMode } from "@/lib/delist-risk";

const STORAGE_KEY = "delist-detection-mode";

export function useDelistMode() {
  const [mode, setModeState] = useState<DelistMode>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "auto_taostats" || v === "auto_taomarketcap" || v === "manual") return v;
    } catch {}
    return "manual";
  });

  const setMode = useCallback((m: DelistMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }, []);

  return { delistMode: mode, setDelistMode: setMode };
}
