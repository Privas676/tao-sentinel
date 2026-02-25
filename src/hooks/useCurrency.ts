import { useState, useCallback } from "react";

export type Currency = "USD" | "TAO";

export function useCurrency() {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    return (localStorage.getItem("tao-sentinel-currency") as Currency) || "USD";
  });

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem("tao-sentinel-currency", c);
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrency(currency === "USD" ? "TAO" : "USD");
  }, [currency, setCurrency]);

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
