import { createContext, useContext, useState, useCallback, ReactNode } from "react";

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
  "phase.none": { fr: "—", en: "—" },

  // Navigation
  "nav.gauge": { fr: "Alien Gauge", en: "Alien Gauge" },
  "nav.subnets": { fr: "Subnets", en: "Subnets" },
  "nav.alerts": { fr: "Alertes", en: "Alerts" },
  "nav.portfolio": { fr: "Portefeuille", en: "Portfolio" },
  "nav.settings": { fr: "Réglages", en: "Settings" },

  // Gauge labels
  "gauge.global": { fr: "PSI GLOBAL", en: "GLOBAL PSI" },
  "gauge.confidence": { fr: "CONFIANCE", en: "CONFIDENCE" },
  "gauge.phase": { fr: "PHASE", en: "PHASE" },
  "gauge.notif": { fr: "Activer les notifications", en: "Enable notifications" },
  "gauge.opportunity": { fr: "OPPORTUNITÉ", en: "OPPORTUNITY" },
  "gauge.risk": { fr: "RISQUE", en: "RISK" },
  "gauge.stability": { fr: "STABILITÉ SETUP", en: "SETUP STABILITY" },
  "gauge.saturation": { fr: "INDICE SATURATION", en: "SATURATION INDEX" },
  "gauge.saturation_alert": { fr: "⚠ Marché saturé — >60% des subnets AS>40", en: "⚠ Market saturated — >60% subnets AS>40" },

  // Tooltip
  "tip.psi": { fr: "PSI", en: "PSI" },
  "tip.phase": { fr: "Phase", en: "Phase" },
  "tip.confidence": { fr: "Confiance", en: "Confidence" },
  "tip.price7d": { fr: "Prix 7j", en: "7d Price" },
  "tip.asym": { fr: "ASYM", en: "ASYM" },
  "tip.why": { fr: "Pourquoi ?", en: "Why?" },
  "asym.high": { fr: "HAUTE", en: "HIGH" },
  "asym.med": { fr: "MOYENNE", en: "MEDIUM" },
  "asym.low": { fr: "FAIBLE", en: "LOW" },

  // Tags
  "tag.low_cap": { fr: "Low Cap", en: "Low Cap" },
  "tag.momentum": { fr: "Momentum", en: "Momentum" },
  "tag.high_risk": { fr: "Risque élevé", en: "High Risk" },
  "tag.consensus": { fr: "Consensus", en: "Consensus" },
  "tag.micro_cap": { fr: "Micro-Cap", en: "Micro-Cap" },
  "tag.pre_hype": { fr: "Pré-Hype détecté", en: "Pre-Hype detected" },

  // Momentum
  "momentum.fort": { fr: "Fort", en: "Strong" },
  "momentum.modere": { fr: "Modéré", en: "Moderate" },
  "momentum.stable": { fr: "Stable", en: "Stable" },
  "momentum.deterioration": { fr: "Détérioration", en: "Deteriorating" },

  // Subnets page
  "sub.title": { fr: "Subnets Détaillés", en: "Detailed Subnets" },
  "sub.name": { fr: "Nom", en: "Name" },
  "sub.psi": { fr: "PSI", en: "PSI" },
  "sub.state": { fr: "État", en: "State" },
  "sub.phase": { fr: "Phase", en: "Phase" },
  "sub.confidence": { fr: "Confiance", en: "Confidence" },
  "sub.momentum": { fr: "Momentum", en: "Momentum" },
  "sub.opp": { fr: "Opportunité", en: "Opportunity" },
  "sub.risk": { fr: "Risque", en: "Risk" },
  "sub.open_pos": { fr: "Ouvrir", en: "Open" },
  "sub.mode": { fr: "Mode", en: "Mode" },
  "sub.mode_opp": { fr: "Opportunités", en: "Opportunities" },
  "sub.mode_risk": { fr: "Risques", en: "Risks" },
  "sub.mode_all": { fr: "Tous", en: "All" },
  "sub.phase_all": { fr: "Toutes les phases", en: "All phases" },
  "sub.tminus": { fr: "Fenêtre", en: "Window" },

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
  "pos.protection": { fr: "Protection", en: "Protection" },
  "pos.exit_rec": { fr: "Sortie recommandée", en: "Recommended Exit" },
  "pos.no_position": { fr: "Aucune position ouverte", en: "No open position" },
  "pos.open": { fr: "Ouvrir une position", en: "Open a position" },
  "pos.close": { fr: "Fermer", en: "Close" },
  "pos.take_partial": { fr: "Prendre profit", en: "Take Profit" },
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
  "pos.obj_x2": { fr: "×2", en: "×2" },
  "pos.obj_x5": { fr: "×5", en: "×5" },
  "pos.obj_x10": { fr: "×10", en: "×10" },
  "pos.obj_x20": { fr: "×20", en: "×20" },
  "pos.obj_custom": { fr: "Custom", en: "Custom" },
  "pos.stop_mode": { fr: "Mode Stop-Loss", en: "Stop-Loss Mode" },
  "pos.stop_dynamic": { fr: "Trailing stop", en: "Trailing stop" },
  "pos.stop_manual": { fr: "Stop fixe", en: "Fixed stop" },
  "pos.entry_price": { fr: "Prix d'entrée", en: "Entry Price" },
  "pos.estimated_qty": { fr: "Quantité estimée", en: "Estimated Qty" },
  "pos.cancel": { fr: "Annuler", en: "Cancel" },
  "pos.close_confirm": { fr: "Fermer la position ?", en: "Close position?" },
  "pos.login_required": { fr: "Connectez-vous pour gérer vos positions", en: "Sign in to manage positions" },
  "pos.alert_sl": { fr: "⛔ STOP-LOSS ATTEINT", en: "⛔ STOP-LOSS HIT" },
  "pos.alert_tp": { fr: "🎯 TAKE-PROFIT ATTEINT", en: "🎯 TAKE-PROFIT HIT" },
  "pos.exit_warn_sc": { fr: "⚠ Smart Capital en Distribution — sortie recommandée", en: "⚠ Smart Capital Distribution — exit recommended" },
  "pos.exit_warn_risk": { fr: "⚠ Risque élevé (>70) — sortie recommandée", en: "⚠ High risk (>70) — exit recommended" },
  "pos.partial_tp": { fr: "Prise de profit partielle", en: "Partial take-profit" },
  "pos.partial_25_x2": { fr: "25% à ×2", en: "25% at ×2" },
  "pos.partial_25_x5": { fr: "25% à ×5", en: "25% at ×5" },
  "pos.partial_50_x10": { fr: "50% à ×10", en: "50% at ×10" },

  // Priority
  "priority.current": { fr: "PRIORITÉ ACTUELLE", en: "CURRENT PRIORITY" },
  "priority.before": { fr: "avant risque potentiel", en: "before potential risk" },

  // Header
  "header.title": { fr: "TAO SENTINEL", en: "TAO SENTINEL" },
  "mode.hunter": { fr: "CHASSEUR", en: "HUNTER" },
  "mode.defensive": { fr: "DÉFENSIF", en: "DEFENSIVE" },
  "mode.bag_builder": { fr: "BAG BUILDER", en: "BAG BUILDER" },

  // Smart Capital
  "sc.label": { fr: "SMART CAPITAL", en: "SMART CAPITAL" },
  "sc.accumulation": { fr: "Accumulation", en: "Accumulation" },
  "sc.stable": { fr: "Stable", en: "Stable" },
  "sc.distribution": { fr: "Distribution", en: "Distribution" },

  // Dual Core
  "dc.structure": { fr: "CORE STRUCTURE", en: "CORE STRUCTURE" },
  "dc.sniper": { fr: "CORE SNIPER", en: "CORE SNIPER" },

  // Strategic recommendation
  "strat.label": { fr: "RECOMMANDATION", en: "RECOMMENDATION" },
  "strat.enter": { fr: "ENTRER", en: "ENTER" },
  "strat.watch": { fr: "ATTENDRE", en: "WAIT" },
  "strat.exit": { fr: "SORTIR", en: "EXIT" },

  // Macro recommendation
  "macro.label": { fr: "RECOMMANDATION MACRO", en: "MACRO RECOMMENDATION" },
  "macro.increase": { fr: "AUGMENTER EXPOSITION", en: "INCREASE EXPOSURE" },
  "macro.reduce": { fr: "RÉDUIRE EXPOSITION", en: "REDUCE EXPOSURE" },
  "macro.neutral": { fr: "NEUTRE", en: "NEUTRAL" },
  "macro.regime": { fr: "RÉGIME MARCHÉ", en: "MARKET REGIME" },
  "macro.stability": { fr: "STABILITÉ MARCHÉ", en: "MARKET STABILITY" },
  "macro.global_index": { fr: "INDICE GLOBAL TAO", en: "TAO GLOBAL INDEX" },

  // Sentinel Index
  "sentinel.index": { fr: "INDICE TAO SENTINEL", en: "TAO SENTINEL INDEX" },
  "sentinel.offensive": { fr: "OFFENSIF", en: "OFFENSIVE" },
  "sentinel.neutral": { fr: "NEUTRE", en: "NEUTRAL" },
  "sentinel.defensive": { fr: "DÉFENSIF", en: "DEFENSIVE" },

  // Flow / Rotation
  "flow.dominance": { fr: "Dominance", en: "Dominance" },
  "flow.emission": { fr: "Émission", en: "Emission" },
  "flow.inflow": { fr: "Flux entrant", en: "Inflow" },

  // Top sections
  "top.opportunities": { fr: "TOP OPPORTUNITÉS", en: "TOP OPPORTUNITIES" },
  "top.risks": { fr: "RISQUES CRITIQUES", en: "CRITICAL RISKS" },
  "top.best": { fr: "MEILLEURE ASYMÉTRIE", en: "BEST ASYMMETRY" },
  "top.best_micro": { fr: "MEILLEUR MICRO-CAP", en: "BEST MICRO-CAP" },

  // Ray labels
  "ray.before": { fr: "avant bascule", en: "before shift" },

  // Position actions
  "pos.close_position": { fr: "Fermer position", en: "Close position" },
  "pos.take_profit_btn": { fr: "Prendre profit", en: "Take Profit" },

  // Auth
  "auth.logout": { fr: "Déconnexion", en: "Sign out" },

  // AS_micro
  "as_micro.label": { fr: "AS MICRO", en: "AS MICRO" },
  "pre_hype.label": { fr: "PRÉ-HYPE", en: "PRE-HYPE" },
  "pre_hype.detected": { fr: "Pré-Hype détecté", en: "Pre-Hype detected" },
  "pre_hype.intensity": { fr: "Intensité", en: "Intensity" },

  // DataFusion
  "data.confiance": { fr: "CONFIANCE DATA", en: "DATA CONFIDENCE" },
  "data.divergence": { fr: "Divergence détectée", en: "Divergence detected" },
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
