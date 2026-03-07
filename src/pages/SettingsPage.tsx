import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n, Lang } from "@/lib/i18n";
import { useOverrideMode } from "@/hooks/use-override-mode";
import { useDelistMode } from "@/hooks/use-delist-mode";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import type { DelistMode } from "@/lib/delist-risk";
import { useAuditExport, useAuditReplay, type ReplayEntry } from "@/hooks/use-audit-log";
import BacktestPanel from "@/components/BacktestPanel";
import PushLogDashboard from "@/components/PushLogDashboard";

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { mode, setMode } = useOverrideMode();
  const { delistMode, setDelistMode } = useDelistMode();
  const { dataConfidence } = useSubnetScores();
  const fr = lang === "fr";
  const { exportAudit, isExporting } = useAuditExport();
  const replay = useAuditReplay();
  const [replayHours, setReplayHours] = useState(24);
  const [replayNetuid, setReplayNetuid] = useState("");
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem("DEBUG_MODE") === "true");

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
    <div className="h-full w-full bg-background text-foreground p-4 sm:p-6 overflow-auto">
      <h1 className="font-mono text-base sm:text-lg tracking-widest mb-6 sm:mb-8">{t("settings.title")}</h1>

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

        {/* DataConfidence Debug Panel */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "🔬 DEBUG — CONFIANCE DATA" : "🔬 DEBUG — DATA CONFIDENCE"}
          </label>
          {dataConfidence ? (
            <div className="border border-white/10 rounded-lg p-4 space-y-3">
              {/* Global score */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-white/50">
                  {fr ? "Score global" : "Global score"}
                </span>
                <span
                  className="font-mono text-lg font-bold"
                  style={{
                    color: dataConfidence.score >= 70
                      ? "rgba(76,175,80,0.9)"
                      : dataConfidence.score >= 40
                      ? "rgba(255,193,7,0.9)"
                      : "rgba(229,57,53,0.9)",
                  }}
                >
                  {dataConfidence.score}%
                </span>
              </div>

              {dataConfidence.isUnstable && (
                <div className="font-mono text-[10px] text-red-400 bg-red-400/10 rounded px-2 py-1">
                  ⚠ DATA_UNSTABLE — {dataConfidence.reasons.join(" · ")}
                </div>
              )}

              {/* Sub-components */}
              <div className="space-y-1.5">
                {([
                  { key: "errorRate", label: fr ? "Taux erreur API" : "API Error Rate", icon: "🔴" },
                  { key: "latency", label: fr ? "Latence API" : "API Latency", icon: "⏱" },
                  { key: "freshness", label: fr ? "Fraîcheur données" : "Data Freshness", icon: "🕐" },
                  { key: "completeness", label: fr ? "Complétude" : "Completeness", icon: "📊" },
                  { key: "varianceHealth", label: fr ? "Santé variance" : "Variance Health", icon: "📈" },
                ] as const).map(({ key, label, icon }) => {
                  const val = dataConfidence.components[key];
                  const pct = Math.max(0, Math.min(100, val));
                  const color =
                    val >= 70 ? "rgba(76,175,80,0.7)" :
                    val >= 40 ? "rgba(255,193,7,0.7)" :
                    "rgba(229,57,53,0.7)";
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs w-4">{icon}</span>
                      <span className="font-mono text-[10px] text-white/40 flex-1 truncate">{label}</span>
                      <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                      <span className="font-mono text-[10px] w-8 text-right" style={{ color }}>
                        {val}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="font-mono text-xs text-white/20 border border-white/5 rounded-lg px-4 py-3">
              {fr ? "Chargement…" : "Loading…"}
            </div>
          )}
        </div>

        {/* Audit Log Export */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "📋 AUDIT LOG — EXPORT" : "📋 AUDIT LOG — EXPORT"}
          </label>
          <div className="border border-white/10 rounded-lg p-4 space-y-3">
            <p className="font-mono text-[10px] text-white/30">
              {fr
                ? "Exporter l'historique des décisions du moteur (scoring, alertes, kill switch)."
                : "Export engine decision history (scoring, alerts, kill switch)."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => exportAudit("csv", 24)}
                disabled={isExporting}
                className="font-mono text-[11px] px-4 py-2 rounded-lg transition-all"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  opacity: isExporting ? 0.4 : 1,
                }}
              >
                {isExporting ? "…" : "CSV (24h)"}
              </button>
              <button
                onClick={() => exportAudit("json", 24)}
                disabled={isExporting}
                className="font-mono text-[11px] px-4 py-2 rounded-lg transition-all"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  opacity: isExporting ? 0.4 : 1,
                }}
              >
                {isExporting ? "…" : "JSON (24h)"}
              </button>
              <button
                onClick={() => exportAudit("csv", 168)}
                disabled={isExporting}
                className="font-mono text-[11px] px-4 py-2 rounded-lg transition-all"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  opacity: isExporting ? 0.4 : 1,
                }}
              >
                {isExporting ? "…" : "CSV (7d)"}
              </button>
            </div>
          </div>
        </div>

        {/* Replay Mode */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "🔄 REPLAY — BACKTEST DÉCISIONS" : "🔄 REPLAY — BACKTEST DECISIONS"}
          </label>
          <div className="border border-white/10 rounded-lg p-4 space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <span className="font-mono text-[10px] text-white/30 block mb-1">
                  {fr ? "Fenêtre (heures)" : "Window (hours)"}
                </span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={replayHours}
                  onChange={e => setReplayHours(Number(e.target.value) || 24)}
                  className="font-mono text-xs w-full px-3 py-2 rounded-lg"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    color: "rgba(255,255,255,0.7)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                />
              </div>
              <div className="flex-1">
                <span className="font-mono text-[10px] text-white/30 block mb-1">
                  {fr ? "Subnet (optionnel)" : "Subnet (optional)"}
                </span>
                <input
                  type="number"
                  placeholder="ex: 18"
                  value={replayNetuid}
                  onChange={e => setReplayNetuid(e.target.value)}
                  className="font-mono text-xs w-full px-3 py-2 rounded-lg"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    color: "rgba(255,255,255,0.7)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                />
              </div>
              <button
                onClick={() => {
                  const to = new Date();
                  const from = new Date(to.getTime() - replayHours * 3600000);
                  const nid = replayNetuid ? Number(replayNetuid) : undefined;
                  replay.loadReplay(from, to, nid);
                }}
                disabled={replay.isLoading}
                className="font-mono text-[11px] px-4 py-2 rounded-lg transition-all whitespace-nowrap"
                style={{
                  background: "rgba(76,175,80,0.1)",
                  color: "rgba(76,175,80,0.8)",
                  border: "1px solid rgba(76,175,80,0.2)",
                  opacity: replay.isLoading ? 0.4 : 1,
                }}
              >
                {replay.isLoading ? "…" : (fr ? "Charger" : "Load")}
              </button>
            </div>

            {/* Replay viewer */}
            {replay.total > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-white/40">
                    {replay.cursor + 1} / {replay.total}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => replay.step(-10)} className="font-mono text-[10px] px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>⏪</button>
                    <button onClick={() => replay.step(-1)} className="font-mono text-[10px] px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>◀</button>
                    <button onClick={() => replay.step(1)} className="font-mono text-[10px] px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>▶</button>
                    <button onClick={() => replay.step(10)} className="font-mono text-[10px] px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>⏩</button>
                  </div>
                </div>

                {/* Scrubber */}
                <input
                  type="range"
                  min={0}
                  max={replay.total - 1}
                  value={replay.cursor}
                  onChange={e => replay.setCursor(Number(e.target.value))}
                  className="w-full h-1 accent-green-500/60"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                />

                {/* Current entry detail */}
                {replay.current && (
                  <div className="border border-white/[0.06] rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-white/60">
                        {new Date(replay.current.ts).toLocaleString()}
                      </span>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{
                        background: replay.current.event_type === "KILL_SWITCH"
                          ? "rgba(229,57,53,0.15)"
                          : replay.current.event_type === "STATE_CHANGE"
                          ? "rgba(255,193,7,0.15)"
                          : "rgba(76,175,80,0.15)",
                        color: replay.current.event_type === "KILL_SWITCH"
                          ? "rgba(229,57,53,0.8)"
                          : replay.current.event_type === "STATE_CHANGE"
                          ? "rgba(255,193,7,0.8)"
                          : "rgba(76,175,80,0.8)",
                      }}>
                        {replay.current.event_type}
                      </span>
                    </div>
                    {replay.current.netuid != null && (
                      <div className="font-mono text-[10px] text-white/40">SN-{replay.current.netuid}</div>
                    )}
                    {replay.current.decision_reason && (
                      <div className="font-mono text-[10px] text-white/50 italic">{replay.current.decision_reason}</div>
                    )}
                    {replay.current.data_confidence != null && (
                      <div className="font-mono text-[10px] text-white/30">
                        Confidence: {replay.current.data_confidence}%
                        {replay.current.kill_switch_active && " · 🛡 SAFE MODE"}
                      </div>
                    )}
                    <details className="mt-1">
                      <summary className="font-mono text-[9px] text-white/20 cursor-pointer">
                        {fr ? "Détail JSON" : "JSON detail"}
                      </summary>
                      <pre className="font-mono text-[8px] text-white/20 mt-1 max-h-32 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify({ inputs: replay.current.inputs, outputs: replay.current.outputs }, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )}

            {replay.total === 0 && !replay.isLoading && (
              <p className="font-mono text-[10px] text-white/20 text-center py-2">
                {fr ? "Aucune entrée. Lancez d'abord le chargement." : "No entries. Load data first."}
              </p>
            )}
          </div>
        </div>

        {/* Push Log Dashboard */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "📡 PUSH LOG — NOTIFICATIONS" : "📡 PUSH LOG — NOTIFICATIONS"}
          </label>
          <div className="border border-white/10 rounded-lg p-4">
            <p className="font-mono text-[10px] text-white/30 mb-3">
              {fr
                ? "Historique des notifications push : statut, priorité, retries et déduplication."
                : "Push notification history: status, priority, retries and deduplication."}
            </p>
            <PushLogDashboard />
          </div>
        </div>

        {/* Debug Mode Toggle + Quant Diagnostics */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "🧪 MODE DEBUG" : "🧪 DEBUG MODE"}
          </label>
          <div className="border border-white/10 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-white/30">
                {fr ? "Activer les outils de diagnostic avancé" : "Enable advanced diagnostic tools"}
              </span>
              <button
                onClick={() => {
                  const next = !debugMode;
                  localStorage.setItem("DEBUG_MODE", String(next));
                  setDebugMode(next);
                }}
                className="font-mono text-[10px] px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: debugMode ? "rgba(76,175,80,0.12)" : "rgba(255,255,255,0.05)",
                  color: debugMode ? "rgba(76,175,80,0.8)" : "rgba(255,255,255,0.3)",
                  border: `1px solid ${debugMode ? "rgba(76,175,80,0.25)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                {debugMode ? "ON" : "OFF"}
              </button>
            </div>

            {debugMode && (
              <Link
                to="/quant-diagnostics"
                className="inline-flex items-center gap-2 font-mono text-[10px] tracking-wider px-3 py-2 rounded-lg transition-all"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.5)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                🔬 {fr ? "Ouvrir Quant Diagnostics" : "Open Quant Diagnostics"} →
              </Link>
            )}
          </div>
        </div>

        {/* Backtest Report */}
        <div>
          <label className="font-mono text-xs tracking-widest text-white/40 mb-3 block">
            {fr ? "📊 BACKTEST — FIABILITÉ MOTEUR" : "📊 BACKTEST — ENGINE RELIABILITY"}
          </label>
          <div className="border border-white/10 rounded-lg p-4">
            <p className="font-mono text-[10px] text-white/30 mb-3">
              {fr
                ? "Rejoue la DecisionLayer sur les snapshots historiques et mesure : faux positifs, faux négatifs, délai de détection et stabilité (flapping)."
                : "Replays the DecisionLayer on historical snapshots and measures: false positives, false negatives, detection delay and stability (flapping)."}
            </p>
            <BacktestPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
