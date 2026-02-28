/**
 * Override Mode Store
 * Controls whether RISK_OVERRIDE alerts use strict or permissive gating.
 * - Strict (default): Risk ≥ 70 + Confidence ≥ 70% + ≥ 2 critical signals
 * - Permissive: Any override is shown (legacy behavior)
 */

import { useState, useCallback, useSyncExternalStore } from "react";

type OverrideMode = "strict" | "permissive";

const KEY = "vpro-override-mode";

function getSnapshot(): OverrideMode {
  return (localStorage.getItem(KEY) as OverrideMode) || "strict";
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

let listeners: (() => void)[] = [];

function notify() {
  listeners.forEach(l => l());
}

export function useOverrideMode() {
  const [mode, setModeState] = useState<OverrideMode>(getSnapshot);

  const setMode = useCallback((m: OverrideMode) => {
    localStorage.setItem(KEY, m);
    setModeState(m);
  }, []);

  return { mode, setMode };
}
