export type Lang = "en" | "fr";

const translations = {
  // Navigation
  "nav.radar": { en: "Operator Radar", fr: "Radar Opérateur" },
  "nav.subnets": { en: "Subnets", fr: "Sous-réseaux" },
  "nav.alerts": { en: "Alerts", fr: "Alertes" },
  "nav.settings": { en: "Settings", fr: "Paramètres" },

  // App
  "app.title": { en: "TAO Sentinel", fr: "TAO Sentinel" },
  "app.subtitle": { en: "Operator Hybrid v3", fr: "Opérateur Hybride v3" },
  "app.testMode": { en: "TEST MODE – Data refresh every 5 minutes", fr: "MODE TEST – Rafraîchissement toutes les 5 minutes" },
  "app.dataStale": { en: "Data stale", fr: "Données obsolètes" },

  // Signal states
  "signal.GO": { en: "GO", fr: "ENTRER" },
  "signal.GO_SPECULATIVE": { en: "GO SPEC", fr: "ENTRER SPEC" },
  "signal.HOLD": { en: "HOLD", fr: "CONSERVER" },
  "signal.BREAK": { en: "BREAK", fr: "SORTIE" },
  "signal.WATCH": { en: "WATCH", fr: "SURVEILLANCE" },
  "signal.NO": { en: "NO", fr: "AUCUN" },

  // Radar page
  "radar.title": { en: "Operator Radar", fr: "Radar Opérateur" },
  "radar.subtitle": { en: "Structured entry & exit detection across all Bittensor subnets", fr: "Détection structurée d'entrées et sorties sur tous les sous-réseaux Bittensor" },
  "radar.onlyActionable": { en: "Only Actionable", fr: "Actionnables" },
  "radar.onlyPass": { en: "Only PASS", fr: "PASS uniquement" },
  "radar.hideWatch": { en: "Hide WATCH", fr: "Masquer WATCH" },
  "radar.noSignals": { en: "No signals", fr: "Aucun signal" },

  // Table headers
  "table.subnet": { en: "Subnet", fr: "Sous-réseau" },
  "table.action": { en: "Action", fr: "Action" },
  "table.score": { en: "Score", fr: "Score" },
  "table.accel": { en: "Accel", fr: "Accél." },
  "table.liquidity": { en: "Liquidity", fr: "Liquidité" },
  "table.miner": { en: "Miner", fr: "Mineurs" },
  "table.why": { en: "Why", fr: "Pourquoi" },
  "table.price": { en: "Price", fr: "Prix" },
  "table.cap": { en: "Cap", fr: "Cap." },
  "table.vol24h": { en: "Vol(24h)", fr: "Vol(24h)" },
  "table.volCap": { en: "Vol/Cap", fr: "Vol/Cap" },
  "table.flow3m": { en: "Flow(3m)", fr: "Flux(3m)" },
  "table.signal": { en: "Signal", fr: "Signal" },

  // Ecosystem
  "eco.title": { en: "Ecosystem Health", fr: "Santé de l'écosystème" },
  "eco.goPercent": { en: "GO %", fr: "% ENTRER" },
  "eco.breakPercent": { en: "BREAK %", fr: "% SORTIE" },
  "eco.liqSlope": { en: "Liq. Slope", fr: "Pente Liq." },
  "eco.phase": { en: "Phase", fr: "Phase" },
  "eco.expansion": { en: "Expansion", fr: "Expansion" },
  "eco.neutral": { en: "Neutral", fr: "Neutre" },
  "eco.riskOff": { en: "Risk-Off", fr: "Aversion Risque" },

  // Subnet detail
  "detail.score": { en: "Score", fr: "Score" },
  "detail.confidence": { en: "Confidence", fr: "Confiance" },
  "detail.high": { en: "High", fr: "Haute" },
  "detail.medium": { en: "Medium", fr: "Moyenne" },
  "detail.low": { en: "Low", fr: "Basse" },
  "detail.drivers": { en: "Drivers", fr: "Facteurs" },
  "detail.events": { en: "Event Timeline", fr: "Chronologie" },
  "detail.flow": { en: "Flow Multi-TF", fr: "Flux Multi-TF" },
  "detail.liqTrend": { en: "Liquidity Trend", fr: "Tendance Liquidité" },
  "detail.priceTrend": { en: "Price", fr: "Prix" },
  "detail.noEvents": { en: "No events in this range", fr: "Aucun événement" },

  // Alerts
  "alerts.title": { en: "Alerts", fr: "Alertes" },
  "alerts.subtitle": { en: "Signal events across all subnets", fr: "Événements sur tous les sous-réseaux" },
  "alerts.noEvents": { en: "No events yet", fr: "Aucun événement" },
  "alerts.evidence": { en: "Evidence details", fr: "Détails" },
  "alerts.severity": { en: "Severity", fr: "Sévérité" },

  // Settings
  "settings.title": { en: "Settings", fr: "Paramètres" },
  "settings.subtitle": { en: "Configure how you receive signal alerts", fr: "Configurez vos alertes" },
  "settings.sound": { en: "Sound Alerts", fr: "Alertes sonores" },
  "settings.soundDesc": { en: "Play an audible tone when a signal fires", fr: "Jouer un son lors d'un signal" },
  "settings.soundOn": { en: "Sound enabled", fr: "Son activé" },
  "settings.soundOff": { en: "Sound disabled", fr: "Son désactivé" },
  "settings.push": { en: "Push Notifications", fr: "Notifications Push" },
  "settings.pushDesc": { en: "Show browser notifications in the background", fr: "Afficher les notifications navigateur" },
  "settings.pushOn": { en: "Notifications enabled", fr: "Notifications activées" },
  "settings.pushOff": { en: "Notifications disabled", fr: "Notifications désactivées" },
  "settings.permBlocked": { en: "Notifications blocked by browser", fr: "Notifications bloquées par le navigateur" },
  "settings.permRequired": { en: "Permission required", fr: "Permission requise" },
  "settings.permGranted": { en: "Permission granted — active", fr: "Permission accordée — actif" },
  "settings.grantPerm": { en: "Grant Permission", fr: "Autoriser" },

  // Why reasons (display-ready)
  "why.flowAccel": { en: "Flow acceleration confirmed", fr: "Accélération du flux confirmée" },
  "why.strongBuys": { en: "Strong buy pressure", fr: "Forte pression acheteuse" },
  "why.priceCompression": { en: "Price compression before breakout", fr: "Compression de prix pré-breakout" },
  "why.liqStable": { en: "Liquidity stable", fr: "Liquidité stable" },
  "why.minerStrong": { en: "Miner stability strong", fr: "Stabilité mineurs forte" },
  "why.liqShock": { en: "Liquidity shock detected", fr: "Choc de liquidité détecté" },
  "why.flowBreakdown": { en: "Flow breakdown detected", fr: "Effondrement du flux détecté" },
  "why.priceDropped": { en: "Price dropped sharply", fr: "Chute de prix brutale" },
  "why.scoreDrop": { en: "Score dropped rapidly", fr: "Score en chute rapide" },
  "why.minerFail": { en: "Miner became FAIL", fr: "Mineurs passés en FAIL" },

  // Filters
  "filter.all": { en: "ALL", fr: "TOUS" },
  "filter.search": { en: "Search subnet...", fr: "Rechercher..." },

  // Miner
  "miner.pass": { en: "PASS", fr: "OK" },
  "miner.warn": { en: "WARN", fr: "ALERTE" },
  "miner.fail": { en: "FAIL", fr: "ÉCHEC" },

  // Liq indicator
  "liq.up": { en: "Up", fr: "Hausse" },
  "liq.stable": { en: "Stable", fr: "Stable" },
  "liq.down": { en: "Down", fr: "Baisse" },

  // Banner
  "banner.goSignal": { en: "GO Signal", fr: "Signal ENTRER" },
  "banner.breakSignal": { en: "BREAK Signal", fr: "Signal SORTIE" },
  "banner.view": { en: "View", fr: "Voir" },

  // Subnets Overview
  "subnets.title": { en: "Subnets Overview", fr: "Vue d'ensemble" },
  "subnets.subtitle": { en: "All subnets with live metrics and signals", fr: "Tous les sous-réseaux avec métriques et signaux" },
  "subnets.updated": { en: "Updated", fr: "Mis à jour" },
  "subnets.noData": { en: "No subnet data available yet", fr: "Aucune donnée disponible" },

  // Loading
  "loading": { en: "Loading...", fr: "Chargement..." },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, lang: Lang): string {
  return translations[key]?.[lang] || key;
}

export default translations;
