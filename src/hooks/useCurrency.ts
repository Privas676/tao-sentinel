import { useState, useCallback, useSyncExternalStore } from "react";

export type Currency = "USD" | "TAO";

const KEY = "tao-sentinel-currency";
let listeners: Array<() => void> = [];

function emitChange() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): Currency {
  return (localStorage.getItem(KEY) as Currency) || "USD";
}

function setCurrencyValue(c: Currency) {
  localStorage.setItem(KEY, c);
  emitChange();
}

export function useCurrency() {
  const currency = useSyncExternalStore(subscribe, getSnapshot, () => "USD" as Currency);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyValue(c);
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrencyValue(getSnapshot() === "USD" ? "TAO" : "USD");
  }, []);

  const formatValue = useCallback(
    (taoValue: number | null | undefined, taoUsd: number | null | undefined) => {
      if (taoValue == null) return "—";
      if (currency === "USD" && taoUsd) {
        return `$${(taoValue * taoUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      }
      return `τ${taoValue.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
    },
    [currency]
  );

  return { currency, setCurrency, toggleCurrency, formatValue };
}
