import { useState } from "react";
import { useI18n, Lang } from "@/lib/i18n";
import { useOverrideMode } from "@/hooks/use-override-mode";
import { useDelistMode } from "@/hooks/use-delist-mode";
import type { DelistMode } from "@/lib/delist-risk";

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { mode, setMode } = useOverrideMode();
  const { delistMode, setDelistMode } = useDelistMode();
  const fr = lang === "fr";

  // Minor divergences toggle removed — TMC decoupled from alerts

  const delistOptions: { value: DelistMode; label: string; desc: string }[] = [
    {
      value: "manual",
      label: fr ? "📋 Manuel" : "📋 Manual",
      desc: fr ? "Listes Taoflute (DEPEG + Proche Delist)" : "Taoflute lists (DEPEG + Near Delist)",
    },
    {
      value: "auto_taostats",
      label: fr ? "🤖 Auto (Taostats)" : "🤖 Auto (Taostats)",
      desc: fr ? "Score calculé via métriques Taostats" : "Score computed from Taostats metrics",
    },
  ];

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <h1 className="font-mono text-base sm:text-lg tracking-widest text-white/80 mb-6 sm:mb-8">{t("settings.title")}</h1>

      <div className="max-w-md space-y-8">
        {/* Language */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">{t("settings.language")}</label>
          <div className="flex gap-2">
            {(["fr", "en"] as Lang[]).map(l => (
              <button key={l} onClick={() => setLang(l)}
                className="font-mono text-sm px-5 py-2.5 rounded-lg transition-all tracking-wider"
                style={{
                  background: lang === l ? "rgba(255,255,255,0.1)" : "transparent",
                  color: lang === l ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)",
                  border: `1px solid ${lang === l ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)"}`,
                }}>
                {l === "fr" ? "Français" : "English"}
              </button>
            ))}
          </div>
        </div>

        {/* Delist Detection Mode */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "DÉTECTION DEPEG / DELIST" : "DEPEG / DELIST DETECTION"}
          </label>
          <div className="flex flex-col gap-2">
            {delistOptions.map(opt => (
              <button key={opt.value} onClick={() => setDelistMode(opt.value)}
                className="font-mono text-sm px-4 py-3 rounded-lg transition-all tracking-wider text-left"
                style={{
                  background: delistMode === opt.value ? "rgba(229,57,53,0.1)" : "transparent",
                  color: delistMode === opt.value ? "rgba(229,57,53,0.9)" : "rgba(255,255,255,0.3)",
                  border: `1px solid ${delistMode === opt.value ? "rgba(229,57,53,0.3)" : "rgba(255,255,255,0.05)"}`,
                }}>
                <div>{opt.label}</div>
                <div className="text-[10px] mt-0.5" style={{ opacity: 0.5 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] text-white/25 mt-2">
            {fr
              ? "Le mode Manuel sera remplacé lorsque la détection Auto sera fiable."
              : "Manual mode will be deprecated once Auto detection is reliable."}
          </p>
        </div>

        {/* Override Mode */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "MODE ALERTES OVERRIDE" : "OVERRIDE ALERTS MODE"}
          </label>
          <div className="flex gap-2">
            {(["strict", "permissive"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className="font-mono text-sm px-5 py-2.5 rounded-lg transition-all tracking-wider"
                style={{
                  background: mode === m ? (m === "strict" ? "rgba(76,175,80,0.12)" : "rgba(255,152,0,0.12)") : "transparent",
                  color: mode === m ? (m === "strict" ? "rgba(76,175,80,0.9)" : "rgba(255,152,0,0.9)") : "rgba(255,255,255,0.3)",
                  border: `1px solid ${mode === m ? (m === "strict" ? "rgba(76,175,80,0.3)" : "rgba(255,152,0,0.3)") : "rgba(255,255,255,0.05)"}`,
                }}>
                {m === "strict"
                  ? (fr ? "🛡 Strict" : "🛡 Strict")
                  : (fr ? "⚡ Permissif" : "⚡ Permissive")}
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] text-white/25 mt-2">
            {mode === "strict"
              ? (fr
                ? "Risk ≥ 70 + Confiance ≥ 70% + ≥ 2 signaux critiques requis. Max 10 affichés."
                : "Risk ≥ 70 + Confidence ≥ 70% + ≥ 2 critical signals required. Max 10 shown.")
              : (fr
                ? "Toutes les alertes override sont affichées (règles legacy)."
                : "All override alerts shown (legacy rules).")}
          </p>
        </div>

        {/* TMC Info */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "CONTEXTE MARCHÉ (TMC)" : "MARKET CONTEXT (TMC)"}
          </label>
          <div className="font-mono text-sm text-white/30 border border-white/10 rounded-lg px-4 py-3">
            {fr
              ? "TMC est affiché en lecture seule. Il n'influence ni le scoring, ni les alertes, ni les overrides."
              : "TMC is displayed read-only. It does not affect scoring, alerts, or overrides."}
          </div>
        </div>

        {/* Refresh */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">{t("settings.refresh")}</label>
          <div className="font-mono text-sm text-white/50 border border-white/10 rounded-lg px-4 py-3">
            60s (signals) · 300s (sparklines)
          </div>
        </div>

        {/* Thresholds */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">{t("settings.thresholds")}</label>
          <div className="space-y-2 font-mono text-xs">
            {[
              ["PRÉPARATION / BUILD", "PSI 35–55"],
              ["SURVEILLANCE / ARMED", "PSI 55–70"],
              ["DÉCLENCHEMENT / TRIGGER", "PSI 70–85"],
              ["IMMINENT", "PSI > 85 + Conf > 70%"],
              ["SORTIE / EXIT", "Risk > 70"],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between border-b border-white/[0.04] pb-2">
                <span className="text-white/40">{label}</span>
                <span className="text-white/60">{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
