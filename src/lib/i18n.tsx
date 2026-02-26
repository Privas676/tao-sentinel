import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";

export type Lang = "fr" | "en";

const translations = {
  // Main states
  "state.calm": { fr: "CALME", en: "CALM" },
  "state.alert": { fr: "ALERTE", en: "ALERT" },
  "state.imminent": { fr: "IMMINENT", en: "IMMINENT" },
  "state.exit": { fr: "SORTIE", en: "EXIT" },

  // Phases
  "phase.build": { fr: "PRÉPARATION", en: "BUILD" },
  "phase.armed": { fr: "SOUS SURVEILLANCE", en: "ARMED" },
  "phase.trigger": { fr: "DÉCLENCHEMENT", en: "TRIGGER" },

  // Navigation
  "nav.gauge": { fr: "Alien Gauge", en: "Alien Gauge" },
  "nav.subnets": { fr: "Subnets", en: "Subnets" },
  "nav.alerts": { fr: "Alertes", en: "Alerts" },
  "nav.settings": { fr: "Réglages", en: "Settings" },

  // Gauge labels
  "gauge.global": { fr: "PSI GLOBAL", en: "GLOBAL PSI" },
  "gauge.confidence": { fr: "CONFIANCE", en: "CONFIDENCE" },
  "gauge.phase": { fr: "PHASE", en: "PHASE" },

  // Tooltip
  "tip.psi": { fr: "PSI", en: "PSI" },
  "tip.phase": { fr: "Phase", en: "Phase" },
  "tip.confidence": { fr: "Confiance", en: "Confidence" },
  "tip.price7d": { fr: "Prix 7j", en: "7d Price" },

  // Subnets page
  "sub.title": { fr: "Subnets Détaillés", en: "Detailed Subnets" },
  "sub.name": { fr: "Nom", en: "Name" },
  "sub.psi": { fr: "PSI", en: "PSI" },
  "sub.state": { fr: "État", en: "State" },
  "sub.phase": { fr: "Phase", en: "Phase" },
  "sub.confidence": { fr: "Confiance", en: "Confidence" },
  "sub.tminus": { fr: "T-minus", en: "T-minus" },

  // Alerts page
  "alerts.title": { fr: "Journal des Signaux", en: "Signal Log" },
  "alerts.empty": { fr: "Aucun signal récent", en: "No recent signals" },

  // Settings page
  "settings.title": { fr: "Réglages", en: "Settings" },
  "settings.language": { fr: "Langue", en: "Language" },
  "settings.refresh": { fr: "Rafraîchissement", en: "Refresh Rate" },
  "settings.thresholds": { fr: "Seuils PSI", en: "PSI Thresholds" },

  // Filters
  "filter.all": { fr: "TOUS", en: "ALL" },

  // Panel
  "panel.title": { fr: "Dossier Subnet", en: "Subnet File" },
  "panel.metrics": { fr: "Métriques", en: "Metrics" },
  "panel.liquidity": { fr: "Liquidité", en: "Liquidity" },
  "panel.volume": { fr: "Volume 24h", en: "24h Volume" },
  "panel.miners": { fr: "Mineurs actifs", en: "Active Miners" },
  "panel.cap": { fr: "Cap. Marché", en: "Market Cap" },
  "panel.open_taostats": { fr: "Ouvrir Taostats", en: "Open Taostats" },
} as const;

type TKey = keyof typeof translations;

type I18nContextType = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey) => string;
};

const I18nContext = createContext<I18nContextType>({
  lang: "fr",
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem("alien-gauge-lang");
    return (saved === "en" ? "en" : "fr") as Lang;
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem("alien-gauge-lang", l);
  }, []);

  const t = useCallback((key: TKey) => {
    const entry = translations[key];
    return entry ? entry[lang] : key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
