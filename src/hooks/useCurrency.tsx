import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Currency = "USD" | "TAO";

type CurrencyCtx = {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  toggleCurrency: () => void;
  formatValue: (taoValue: number | null | undefined, taoUsd: number | null | undefined) => string;
};

const CurrencyContext = createContext<CurrencyCtx | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    return (localStorage.getItem("tao-sentinel-currency") as Currency) || "USD";
  });

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem("tao-sentinel-currency", c);
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrencyState((prev) => {
      const next = prev === "USD" ? "TAO" : "USD";
      localStorage.setItem("tao-sentinel-currency", next);
      return next;
    });
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

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, toggleCurrency, formatValue }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
