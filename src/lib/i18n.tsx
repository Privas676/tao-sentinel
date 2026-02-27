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
  "gauge.notif": { fr: "Activer les notifications", en: "Enable notifications" },
  "gauge.window": { fr: "SIGNAL MARCHÉ", en: "MARKET SIGNAL" },
  "gauge.before": { fr: "avant zone de bascule", en: "before tipping zone" },
  "gauge.pressure": { fr: "PRESSION", en: "PRESSURE" },
  "gauge.remaining": { fr: "Fenêtre d'opportunité restante", en: "Remaining opportunity window" },
  "gauge.before_risk": { fr: "avant risque potentiel", en: "before potential risk" },

  // Tooltip
  "tip.psi": { fr: "PSI", en: "PSI" },
  "tip.phase": { fr: "Phase", en: "Phase" },
  "tip.confidence": { fr: "Confiance", en: "Confidence" },
  "tip.price7d": { fr: "Prix 7j", en: "7d Price" },
  "tip.asym": { fr: "ASYM", en: "ASYM" },
  "asym.high": { fr: "HAUTE", en: "HIGH" },
  "asym.med": { fr: "MOYENNE", en: "MEDIUM" },
  "asym.low": { fr: "FAIBLE", en: "LOW" },

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

  // Position bar
  "pos.capital": { fr: "Capital investi", en: "Invested Capital" },
  "pos.current": { fr: "Valeur actuelle", en: "Current Value" },
  "pos.pnl": { fr: "Gain/Perte", en: "Gain/Loss" },
  "pos.protection": { fr: "Seuil de protection", en: "Protection Threshold" },
  "pos.exit_rec": { fr: "Sortie recommandée", en: "Recommended Exit" },
  "pos.no_position": { fr: "Aucune position ouverte", en: "No open position" },
  "pos.open": { fr: "Ouvrir une position", en: "Open a position" },
  "pos.close": { fr: "Fermer", en: "Close" },
  "pos.profit": { fr: "Profit sécurisé", en: "Secured Profit" },
  "pos.caution": { fr: "Vigilance", en: "Caution" },
  "pos.danger": { fr: "Danger capital", en: "Capital Danger" },
  "pos.open_title": { fr: "Ouvrir une position", en: "Open Position" },
  "pos.subnet": { fr: "Subnet", en: "Subnet" },
  "pos.amount": { fr: "Capital (TAO)", en: "Capital (TAO)" },
  "pos.stop_loss": { fr: "Stop-loss (%)", en: "Stop-loss (%)" },
  "pos.take_profit": { fr: "Take-profit (%)", en: "Take-profit (%)" },
  "pos.confirm": { fr: "Confirmer la position", en: "Confirm Position" },
  "pos.objective": { fr: "Objectif", en: "Objective" },
  "pos.obj_x2": { fr: "×2 (100%)", en: "×2 (100%)" },
  "pos.obj_x5": { fr: "×5 (400%)", en: "×5 (400%)" },
  "pos.obj_custom": { fr: "Personnalisé", en: "Custom" },
  "pos.stop_mode": { fr: "Mode Stop-Loss", en: "Stop-Loss Mode" },
  "pos.stop_dynamic": { fr: "Dynamique (trailing)", en: "Dynamic (trailing)" },
  "pos.stop_manual": { fr: "Manuel (fixe)", en: "Manual (fixed)" },
  "pos.entry_price": { fr: "Prix d'entrée", en: "Entry Price" },
  "pos.estimated_qty": { fr: "Quantité estimée", en: "Estimated Qty" },
  "pos.cancel": { fr: "Annuler", en: "Cancel" },
  "pos.close_confirm": { fr: "Fermer la position ?", en: "Close position?" },
  "pos.login_required": { fr: "Connectez-vous pour gérer vos positions", en: "Sign in to manage positions" },
  "pos.alert_sl": { fr: "⛔ STOP-LOSS ATTEINT", en: "⛔ STOP-LOSS HIT" },
  "pos.alert_tp": { fr: "🎯 TAKE-PROFIT ATTEINT", en: "🎯 TAKE-PROFIT HIT" },
  "pos.alert_sl_body": { fr: "Votre position SN-{netuid} a atteint le seuil de protection ({pct}%). P&L actuel : {pnl}%", en: "Your SN-{netuid} position hit the protection threshold ({pct}%). Current P&L: {pnl}%" },
  "pos.alert_tp_body": { fr: "Votre position SN-{netuid} a atteint la sortie recommandée ({pct}%). P&L actuel : {pnl}%", en: "Your SN-{netuid} position hit the recommended exit ({pct}%). Current P&L: {pnl}%" },

  // Priority
  "priority.current": { fr: "PRIORITÉ ACTUELLE", en: "CURRENT PRIORITY" },
  "priority.before": { fr: "avant risque potentiel", en: "before potential risk" },

  // Auth
  "auth.logout": { fr: "Déconnexion", en: "Sign out" },
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
