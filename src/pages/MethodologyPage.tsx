import { useI18n } from "@/lib/i18n";
import { Link } from "react-router-dom";

/* ═══════════════════════════════════════════════════
 *  Bilingual content blocks
 * ═══════════════════════════════════════════════════ */

const content = {
  fr: {
    title: "Méthodologie",
    subtitle: "Transparence contrôlée — ce que nos scores mesurent et ce qu'ils ne mesurent pas.",
    sections: [
      {
        id: "psi",
        icon: "◎",
        title: "PSI — Performance Signal Index",
        body: `Le PSI est un indice composite qui mesure la **force du signal haussier** d'un subnet Bittensor. Il agrège plusieurs dimensions :`,
        factors: [
          { name: "Momentum de prix", desc: "Variation relative du prix sur plusieurs horizons temporels (1j, 3j, 7j)." },
          { name: "Volume & Liquidité", desc: "Ratio Volume/Market Cap et profondeur de liquidité disponible." },
          { name: "Activité réseau", desc: "Nombre de mineurs actifs, concentration du minage (top miners share)." },
          { name: "Flux de capital", desc: "Mouvements nets de capital entrant/sortant sur des fenêtres glissantes." },
          { name: "Achats on-chain", desc: "Transactions d'achat détectées sur la blockchain Bittensor." },
        ],
        interpretation: `Un PSI élevé (> 70) indique un **alignement multi-facteur** favorable. Le PSI est relatif au marché : un score de 85 signifie que le subnet surperforme 85% des subnets analysés sur ces critères.`,
      },
      {
        id: "risk",
        title: "Score de Risque",
        icon: "⚠",
        body: `Le score de Risque évalue la **probabilité de perte** sur un subnet. Il est indépendant du PSI et peut être élevé même si le signal est fort.`,
        factors: [
          { name: "Volatilité", desc: "Amplitude des variations de prix récentes." },
          { name: "Concentration du minage", desc: "Part des récompenses captée par les top mineurs." },
          { name: "Faiblesse de liquidité", desc: "Profondeur insuffisante pour absorber des ordres." },
          { name: "Décorrélation TAO", desc: "Divergence entre le prix du subnet et le cours de TAO." },
          { name: "Âge du subnet", desc: "Les subnets récents présentent un risque structurel plus élevé." },
          { name: "Override système", desc: "Détection automatique de conditions anormales (pool critique, vol/MC anomalie)." },
        ],
        interpretation: `Un risque > 70 déclenche un signal de sortie. Le score de risque n'est **pas** une prédiction de crash — c'est une mesure de conditions défavorables accumulées.`,
      },
      {
        id: "depeg",
        title: "Politique Depeg & Delist",
        icon: "🔴",
        body: `TAO Sentinel détecte les subnets en risque de **depeg** (perte de valeur structurelle) ou de **delist** (retrait du réseau).`,
        factors: [
          { name: "Émission réseau", desc: "Subnets avec émission nulle ou quasi-nulle." },
          { name: "UIDs actifs", desc: "Nombre de validateurs/mineurs actifs sur le subnet." },
          { name: "Micro-prix", desc: "Prix < 0.008 TAO — signal de désintérêt structurel." },
          { name: "Concentration Cap/Liquidité", desc: "Ratio liquidité/capitalisation > 70% — marché illiquide." },
          { name: "Small Cap", desc: "Capitalisation < 20k TAO — vulnérabilité accrue." },
        ],
        interpretation: `La classification utilise deux niveaux : **RISQUE DEREG** (score ≥ 45, action : SORTIR) et **PROCHE DELIST** (score 28–44, action : SURVEILLER). La détection croise des listes manuelles (watchlists) avec une analyse automatique pour minimiser les faux négatifs.`,
      },
      {
        id: "confidence",
        title: "Confiance Data",
        icon: "🔬",
        body: `Chaque score est accompagné d'un **indice de confiance** qui mesure la fiabilité des données sous-jacentes.`,
        factors: [
          { name: "Taux d'erreur API", desc: "Pourcentage de requêtes échouées vers les sources de données." },
          { name: "Latence", desc: "Temps de réponse des APIs — une latence élevée dégrade la fraîcheur." },
          { name: "Fraîcheur", desc: "Âge des dernières données reçues." },
          { name: "Complétude", desc: "Proportion de métriques disponibles vs attendues." },
          { name: "Santé variance", desc: "Détection d'anomalies statistiques dans les données." },
        ],
        interpretation: `Si la confiance data descend sous 40%, un mode **DATA_UNSTABLE** s'active et tous les signaux d'entrée sont suspendus. Seuls les signaux de sortie et les alertes depeg restent actifs.`,
      },
    ],
    whatItIs: {
      title: "Ce que nos scores signifient",
      items: [
        "Une synthèse **multi-facteur** de conditions de marché observables.",
        "Un outil de **triage** pour identifier les subnets méritant une analyse approfondie.",
        "Un système **auditable** : chaque décision est logguée avec ses facteurs contributifs.",
        "Un filtre de **protection** : les conditions dangereuses sont détectées avant qu'elles ne deviennent critiques.",
      ],
    },
    whatItIsNot: {
      title: "Ce que nos scores ne signifient pas",
      items: [
        "Ce n'est **pas un conseil financier** ni une recommandation d'achat/vente.",
        "Ce n'est **pas une prédiction** du prix futur — aucun modèle ne peut garantir cela.",
        "Le PSI ne mesure **pas la valeur fondamentale** d'un projet.",
        "Un signal GO ne garantit **pas** un profit — il indique un alignement favorable de conditions.",
        "Les pondérations exactes des facteurs ne sont **pas publiées** pour préserver l'intégrité du système.",
      ],
    },
    killSwitch: {
      title: "Kill Switch & Safe Mode",
      body: `En cas de conditions extrêmes (> 10 événements critiques en 2 minutes, > 30% des subnets en zone critique, ou confiance data < 40%), un **mode sécurisé** s'active automatiquement. Seules les alertes depeg (P0) traversent le filtre. Ce mécanisme protège contre les tempêtes de faux signaux.`,
    },
  },
  en: {
    title: "Methodology",
    subtitle: "Controlled transparency — what our scores measure and what they don't.",
    sections: [
      {
        id: "psi",
        icon: "◎",
        title: "PSI — Performance Signal Index",
        body: `PSI is a composite index measuring the **bullish signal strength** of a Bittensor subnet. It aggregates multiple dimensions:`,
        factors: [
          { name: "Price Momentum", desc: "Relative price change across multiple time horizons (1d, 3d, 7d)." },
          { name: "Volume & Liquidity", desc: "Volume/Market Cap ratio and available liquidity depth." },
          { name: "Network Activity", desc: "Active miner count, mining concentration (top miners share)." },
          { name: "Capital Flows", desc: "Net capital inflows/outflows on rolling windows." },
          { name: "On-chain Buys", desc: "Purchase transactions detected on the Bittensor blockchain." },
        ],
        interpretation: `A high PSI (> 70) indicates a favorable **multi-factor alignment**. PSI is market-relative: a score of 85 means the subnet outperforms 85% of analyzed subnets on these criteria.`,
      },
      {
        id: "risk",
        title: "Risk Score",
        icon: "⚠",
        body: `The Risk score evaluates the **probability of loss** on a subnet. It is independent from PSI and can be high even when the signal is strong.`,
        factors: [
          { name: "Volatility", desc: "Recent price variation amplitude." },
          { name: "Mining Concentration", desc: "Share of rewards captured by top miners." },
          { name: "Liquidity Weakness", desc: "Insufficient depth to absorb orders." },
          { name: "TAO Decorrelation", desc: "Divergence between subnet price and TAO price." },
          { name: "Subnet Age", desc: "Newer subnets carry structurally higher risk." },
          { name: "System Override", desc: "Automatic detection of abnormal conditions (critical pool, vol/MC anomaly)." },
        ],
        interpretation: `A risk > 70 triggers an exit signal. The risk score is **not** a crash prediction — it measures accumulated unfavorable conditions.`,
      },
      {
        id: "depeg",
        title: "Depeg & Delist Policy",
        icon: "🔴",
        body: `TAO Sentinel detects subnets at risk of **depeg** (structural value loss) or **delist** (network removal).`,
        factors: [
          { name: "Network Emission", desc: "Subnets with zero or near-zero emission." },
          { name: "Active UIDs", desc: "Number of active validators/miners on the subnet." },
          { name: "Micro-price", desc: "Price < 0.008 TAO — signal of structural disinterest." },
          { name: "Cap/Liquidity Concentration", desc: "Liquidity/capitalization ratio > 70% — illiquid market." },
          { name: "Small Cap", desc: "Capitalization < 20k TAO — increased vulnerability." },
        ],
        interpretation: `Classification uses two levels: **PRIORITY DEPEG** (score ≥ 45, action: EXIT) and **NEAR DELIST** (score 28–44, action: WATCH). Detection cross-references manual watchlists with automatic analysis to minimize false negatives.`,
      },
      {
        id: "confidence",
        title: "Data Confidence",
        icon: "🔬",
        body: `Each score comes with a **confidence index** measuring the reliability of underlying data.`,
        factors: [
          { name: "API Error Rate", desc: "Percentage of failed requests to data sources." },
          { name: "Latency", desc: "API response time — high latency degrades freshness." },
          { name: "Freshness", desc: "Age of the latest data received." },
          { name: "Completeness", desc: "Proportion of available vs expected metrics." },
          { name: "Variance Health", desc: "Statistical anomaly detection in the data." },
        ],
        interpretation: `If data confidence drops below 40%, a **DATA_UNSTABLE** mode activates and all entry signals are suspended. Only exit signals and depeg alerts remain active.`,
      },
    ],
    whatItIs: {
      title: "What our scores mean",
      items: [
        "A **multi-factor** synthesis of observable market conditions.",
        "A **triage** tool to identify subnets deserving deeper analysis.",
        "An **auditable** system: every decision is logged with its contributing factors.",
        "A **protection** filter: dangerous conditions are detected before they become critical.",
      ],
    },
    whatItIsNot: {
      title: "What our scores do NOT mean",
      items: [
        "This is **not financial advice** nor a buy/sell recommendation.",
        "This is **not a prediction** of future price — no model can guarantee that.",
        "PSI does **not measure the fundamental value** of a project.",
        "A GO signal does **not guarantee** profit — it indicates favorable condition alignment.",
        "Exact factor weightings are **not published** to preserve system integrity.",
      ],
    },
    killSwitch: {
      title: "Kill Switch & Safe Mode",
      body: `Under extreme conditions (> 10 critical events in 2 minutes, > 30% of subnets in critical zone, or data confidence < 40%), a **safe mode** activates automatically. Only depeg alerts (P0) pass through the filter. This mechanism protects against false signal storms.`,
    },
  },
};

/* ═══════════════════════════════════════════════════
 *  Markdown-lite bold renderer
 * ═══════════════════════════════════════════════════ */

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="text-white/80 font-semibold">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════
 *  Page Component
 * ═══════════════════════════════════════════════════ */

export default function MethodologyPage() {
  const { lang } = useI18n();
  const c = content[lang === "fr" ? "fr" : "en"];

  return (
    <div className="h-full w-full bg-background text-muted-foreground overflow-auto pt-14 px-4 sm:px-8 pb-16">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-white/25 hover:text-white/50 transition-colors mb-6"
        >
          ← {lang === "fr" ? "Retour à la jauge" : "Back to gauge"}
        </Link>
        <h1 className="font-mono text-lg sm:text-xl tracking-widest text-white/90 mb-2">{c.title}</h1>
        <p className="font-mono text-xs text-white/35 mb-10 leading-relaxed">{c.subtitle}</p>

        {/* Sections */}
        <div className="space-y-10">
          {c.sections.map((s) => (
            <section key={s.id} id={s.id}>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="text-base">{s.icon}</span>
                <h2 className="font-mono text-sm tracking-widest text-white/80 uppercase">{s.title}</h2>
              </div>

              <p className="font-mono text-[11px] text-white/40 leading-relaxed mb-4">
                <RichText text={s.body} />
              </p>

              {/* Factors grid */}
              <div className="space-y-1.5 mb-4">
                {s.factors.map((f) => (
                  <div
                    key={f.name}
                    className="flex gap-3 items-start px-3 py-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <span
                      className="font-mono text-[10px] text-white/50 shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full"
                      style={{ background: "rgba(255,215,0,0.4)", marginTop: 5 }}
                    />
                    <div>
                      <span className="font-mono text-[11px] text-white/60 font-medium">{f.name}</span>
                      <span className="font-mono text-[10px] text-white/30 ml-2">{f.desc}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Interpretation */}
              <div
                className="font-mono text-[10px] text-white/35 leading-relaxed px-3 py-2.5 rounded-lg"
                style={{ background: "rgba(255,215,0,0.03)", borderLeft: "2px solid rgba(255,215,0,0.15)" }}
              >
                <RichText text={s.interpretation} />
              </div>
            </section>
          ))}

          {/* What it is */}
          <section>
            <h2 className="font-mono text-sm tracking-widest text-white/80 uppercase mb-3 flex items-center gap-2">
              <span className="text-base">✅</span> {c.whatItIs.title}
            </h2>
            <div className="space-y-1.5">
              {c.whatItIs.items.map((item, i) => (
                <div key={i} className="flex gap-2 items-start font-mono text-[11px] text-white/45 leading-relaxed">
                  <span className="text-green-500/60 shrink-0 mt-0.5">•</span>
                  <RichText text={item} />
                </div>
              ))}
            </div>
          </section>

          {/* What it is NOT */}
          <section>
            <h2 className="font-mono text-sm tracking-widest text-white/80 uppercase mb-3 flex items-center gap-2">
              <span className="text-base">⛔</span> {c.whatItIsNot.title}
            </h2>
            <div className="space-y-1.5">
              {c.whatItIsNot.items.map((item, i) => (
                <div key={i} className="flex gap-2 items-start font-mono text-[11px] text-white/45 leading-relaxed">
                  <span className="text-red-400/60 shrink-0 mt-0.5">•</span>
                  <RichText text={item} />
                </div>
              ))}
            </div>
          </section>

          {/* Kill Switch */}
          <section>
            <h2 className="font-mono text-sm tracking-widest text-white/80 uppercase mb-3 flex items-center gap-2">
              <span className="text-base">🛡</span> {c.killSwitch.title}
            </h2>
            <div
              className="font-mono text-[11px] text-white/40 leading-relaxed px-4 py-3 rounded-lg"
              style={{ background: "rgba(229,57,53,0.04)", border: "1px solid rgba(229,57,53,0.1)" }}
            >
              <RichText text={c.killSwitch.body} />
            </div>
          </section>

          {/* Version footer */}
          <div className="pt-6 border-t border-white/[0.04] text-center">
            <span className="font-mono text-[9px] text-white/15">
              TAO SENTINEL — Engine v4.1 — {lang === "fr" ? "Dernière mise à jour" : "Last updated"}: {new Date().toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
