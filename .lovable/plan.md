# Tao Sentinel v3 — Refactoring Plan

## Vision
Terminal premium de décision crypto institutionnel pour subnets Bittensor.
3 actions : **RENTRER / HOLD / SORTIR** — données réelles uniquement, verdicts auditables.

---

## Phase 1 : Stabilité Technique ✅ IN PROGRESS
**Objectif** : Zéro crash, zéro écran gris, fallbacks propres.

- [x] Global `TooltipProvider` dans App.tsx
- [ ] Suppression des `TooltipProvider` locaux redondants
- [ ] Error boundaries sur chaque page/onglet Radar
- [ ] Fallback UI pour données manquantes
- [ ] Stabilisation tables et heatmaps
- [ ] Tests de non-régression

---

## Phase 2 : Moteur de Décision v3 (réécriture from scratch)
**Objectif** : Verdict basé sur 4 piliers, règles explicables, raisons auditables.

### 4 Piliers
- **A — Momentum/Flux** : Price 1d/7d/30d, Buy/Sell flow, Stake flow
- **B — AMM/Exécution** : Pool Balance, Depth, Slippage, Spread, AMM efficiency
- **C — Risk/Structure** : Validators, Miners, Concentration, Sell pressure, UID sat, Supply, Burn, Emissions, MCap, Volatility
- **D — Data Quality** : Freshness, Source, Quality badge (stable/partial/suspect/stale)

### Sortie par Subnet
- Verdict : RENTRER / HOLD / SORTIR (+ intensité faible/moyenne/forte)
- 3 raisons max, 3 drapeaux risque max
- Si données insuffisantes : HOLD prudent ou UNRATED

### Fichiers
- `src/lib/verdict-engine-v3.ts` — Nouveau moteur
- `src/lib/verdict-rules.ts` — Règles explicites
- `src/lib/verdict-types.ts` — Types partagés

---

## Phase 3 : Nettoyage UI / Pages

### Dashboard → Page exécutive
- Macro state, Top 5 RENTRER/HOLD/SORTIR, 3 risques critiques, drivers du moment

### Subnets → Table maître avec colonnes configurables
- Colonnes par défaut : SN, Nom, Verdict, Raisons, Prix, 1d/7d/30d, Stake flow, Buy/Sell, Pool depth, Slippage, Spread, Validators, Miners, Concentration, Em/day, Burn ratio, MCap, Data quality
- Filtres rapides, tri multi-critères

### Radar → Laboratoire discipliné
- 7 onglets : Capital Flow, Risk Monitor, AMM/Pricing, Validators, Economics, Heatmap, Smart Money
- Fusionner Adoption, sortir Narrative du cœur

### Portfolio → Cockpit positions
- Verdict actuel + changement, recommandation, AMM quality

### Alerts → Minimaliste actionnable
- Types ciblés, raison + action suggérée

---

## Phase 4 : Design Premium
- Terminal noir/or/rouge/vert
- Espacement respirant, typographie nette, contraste données
- Badges sobres, tables lisibles, alignements impeccables
- Zéro surcharge, zéro gadget

---

## Modules rétrogradés (exploratoire uniquement)
- Bubble monitor, Smart money (ne pilote pas verdict seul), Narrative

## Règles de Fiabilité
1. Jamais de verdict sans signalement données manquantes
2. Jamais de métrique inventée
3. Badge explicite si valeur capée ou heuristique
4. Fraîcheur + source affichées
5. Data Quality globale : stable / partial / suspect / stale
