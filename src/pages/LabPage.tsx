import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import { useAuditExport, useAuditReplay } from "@/hooks/use-audit-log";
import BacktestPanel from "@/components/BacktestPanel";
import PushLogDashboard from "@/components/PushLogDashboard";
import RadarPage from "./RadarPage";
import MethodologyPage from "./MethodologyPage";
import QuantDiagnosticsPage from "./QuantDiagnosticsPage";

/* ═══════════════════════════════════════════════════════ */
/*   LAB — Expert Tools & Diagnostics                      */
/* ═══════════════════════════════════════════════════════ */

const GOLD = "hsl(var(--gold))";
const GO = "hsl(var(--signal-go))";
const BREAK = "hsl(var(--signal-break))";

function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card">{children}</div>;
}

function SectionTitle({ icon, title, badge }: { icon: string; title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border">
      <span className="text-sm opacity-70">{icon}</span>
      <h2 className="font-mono text-[10px] tracking-[0.15em] uppercase text-gold">{title}</h2>
      {badge && <div className="ml-auto">{badge}</div>}
    </div>
  );
}

/* ── Tab types ── */
const TABS = [
  { key: "tools", icon: "🛠", label_fr: "Outils", label_en: "Tools" },
  { key: "radar", icon: "📡", label_fr: "Radar", label_en: "Radar" },
  { key: "quant", icon: "🔬", label_fr: "Quant", label_en: "Quant" },
  { key: "methodology", icon: "📖", label_fr: "Méthodo", label_en: "Method" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function LabPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const [activeTab, setActiveTab] = useState<TabKey>("tools");

  return (
    <div className="h-full w-full bg-background text-foreground overflow-hidden flex flex-col">
      {/* ── Tab Bar ── */}
      <div className="flex-shrink-0 border-b border-border">
        <div className="flex w-full">
          {TABS.map(tab => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabKey)}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-2.5 sm:px-4 sm:py-3 font-mono text-[8px] sm:text-[10px] tracking-wider transition-all relative"
                style={{
                  color: active ? GOLD : "hsl(var(--muted-foreground))",
                  opacity: active ? 1 : 0.5,
                }}
              >
                <span className="text-[10px] sm:text-xs">{tab.icon}</span>
                <span>{fr ? tab.label_fr : tab.label_en}</span>
                {active && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: GOLD }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "tools" && <ToolsPanel />}
        {activeTab === "radar" && <RadarPage />}
        {activeTab === "quant" && <QuantDiagnosticsPage />}
        {activeTab === "methodology" && <MethodologyPage />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*   TOOLS PANEL — Expert Debug & Analysis     */
/* ═══════════════════════════════════════════ */
function ToolsPanel() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const { dataConfidence } = useSubnetScores();
  const { exportAudit, isExporting } = useAuditExport();
  const replay = useAuditReplay();
  const [replayHours, setReplayHours] = useState(24);
  const [replayNetuid, setReplayNetuid] = useState("");
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem("DEBUG_MODE") === "true");

  return (
    <div className="h-full overflow-auto pb-8">
      <div className="px-4 sm:px-6 py-5 max-w-[800px] mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="font-mono text-lg sm:text-xl tracking-wider text-gold">
            {fr ? "Outils Expert" : "Expert Tools"}
          </h1>
          <p className="font-mono text-[10px] text-muted-foreground/45 mt-1 leading-relaxed">
            {fr ? "Diagnostics, export, replay, backtests et logs de notification." : "Diagnostics, export, replay, backtests and notification logs."}
          </p>
        </div>

        {/* ── 1. DATA CONFIDENCE DEBUG ── */}
        <SectionCard>
          <SectionTitle icon="🔬" title={fr ? "Confiance données" : "Data Confidence"} badge={
            dataConfidence ? (
              <span className="font-mono text-[11px] font-bold" style={{
                color: dataConfidence.score >= 70 ? GO : dataConfidence.score >= 40 ? GOLD : BREAK,
              }}>{dataConfidence.score}%</span>
            ) : null
          } />
          <div className="px-5 py-4">
            {dataConfidence ? (
              <div className="space-y-2.5">
                {dataConfidence.isUnstable && (
                  <div className="font-mono text-[10px] text-destructive bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20">
                    ⚠ DATA_UNSTABLE — {dataConfidence.reasons.join(" · ")}
                  </div>
                )}
                {([
                  { key: "errorRate", label: fr ? "Taux erreur API" : "API Error Rate", icon: "🔴" },
                  { key: "latency", label: fr ? "Latence API" : "API Latency", icon: "⏱" },
                  { key: "freshness", label: fr ? "Fraîcheur données" : "Data Freshness", icon: "🕐" },
                  { key: "completeness", label: fr ? "Complétude" : "Completeness", icon: "📊" },
                  { key: "varianceHealth", label: fr ? "Santé variance" : "Variance Health", icon: "📈" },
                ] as const).map(({ key, label, icon }) => {
                  const val = dataConfidence.components[key];
                  const pct = Math.max(0, Math.min(100, val));
                  const color = val >= 70 ? GO : val >= 40 ? GOLD : BREAK;
                  return (
                    <div key={key} className="flex items-center gap-2.5">
                      <span className="text-xs w-4">{icon}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/50 flex-1 truncate">{label}</span>
                      <div className="w-24 h-[5px] bg-muted/20 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                      <span className="font-mono text-[10px] w-8 text-right font-semibold" style={{ color }}>{val}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="font-mono text-[10px] text-muted-foreground/20 py-4 text-center">{fr ? "Chargement…" : "Loading…"}</div>
            )}
          </div>
        </SectionCard>

        {/* ── 2. AUDIT EXPORT ── */}
        <SectionCard>
          <SectionTitle icon="📋" title={fr ? "Export Audit Log" : "Audit Log Export"} />
          <div className="px-5 py-4 space-y-3">
            <p className="font-mono text-[10px] text-muted-foreground/35">
              {fr ? "Historique des décisions du moteur (scoring, alertes, kill switch)." : "Engine decision history (scoring, alerts, kill switch)."}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "CSV (24h)", fmt: "csv" as const, hours: 24 },
                { label: "JSON (24h)", fmt: "json" as const, hours: 24 },
                { label: "CSV (7d)", fmt: "csv" as const, hours: 168 },
              ].map(btn => (
                <button key={btn.label} onClick={() => exportAudit(btn.fmt, btn.hours)} disabled={isExporting}
                  className="font-mono text-[10px] px-3 py-2 rounded-lg border border-border text-muted-foreground/50 hover:text-foreground/70 transition-all disabled:opacity-30">
                  {isExporting ? "…" : btn.label}
                </button>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* ── 3. REPLAY ── */}
        <SectionCard>
          <SectionTitle icon="🔄" title={fr ? "Replay décisions" : "Decision Replay"} />
          <div className="px-5 py-4 space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <span className="font-mono text-[9px] text-muted-foreground/30 block mb-1">{fr ? "Fenêtre (h)" : "Window (h)"}</span>
                <input type="number" min={1} max={168} value={replayHours} onChange={e => setReplayHours(Number(e.target.value) || 24)}
                  className="font-mono text-xs w-full px-3 py-2 rounded-lg bg-muted/20 border border-border text-foreground/70 outline-none focus:border-primary/40" />
              </div>
              <div className="flex-1">
                <span className="font-mono text-[9px] text-muted-foreground/30 block mb-1">{fr ? "Subnet" : "Subnet"}</span>
                <input type="number" placeholder="ex: 18" value={replayNetuid} onChange={e => setReplayNetuid(e.target.value)}
                  className="font-mono text-xs w-full px-3 py-2 rounded-lg bg-muted/20 border border-border text-foreground/70 outline-none focus:border-primary/40 placeholder:text-muted-foreground/20" />
              </div>
              <button
                onClick={() => {
                  const to = new Date();
                  const from = new Date(to.getTime() - replayHours * 3600000);
                  const nid = replayNetuid ? Number(replayNetuid) : undefined;
                  replay.loadReplay(from, to, nid);
                }}
                disabled={replay.isLoading}
                className="font-mono text-[10px] px-4 py-2 rounded-lg border transition-all whitespace-nowrap disabled:opacity-30"
                style={{ borderColor: `color-mix(in srgb, ${GO} 25%, transparent)`, color: GO, background: `color-mix(in srgb, ${GO} 8%, transparent)` }}>
                {replay.isLoading ? "…" : (fr ? "Charger" : "Load")}
              </button>
            </div>

            {/* Replay viewer */}
            {replay.total > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground/40">{replay.cursor + 1} / {replay.total}</span>
                  <div className="flex gap-1">
                    {[
                      { label: "⏪", step: -10 },
                      { label: "◀", step: -1 },
                      { label: "▶", step: 1 },
                      { label: "⏩", step: 10 },
                    ].map(b => (
                      <button key={b.label} onClick={() => replay.step(b.step)}
                        className="font-mono text-[10px] px-2 py-1 rounded bg-muted/20 text-muted-foreground/40 hover:text-foreground/60 transition-colors">
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                <input type="range" min={0} max={replay.total - 1} value={replay.cursor}
                  onChange={e => replay.setCursor(Number(e.target.value))}
                  className="w-full h-1 accent-primary/60 bg-muted/10" />

                {replay.current && (
                  <div className="border border-border rounded-lg p-3 space-y-1.5 bg-muted/5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-foreground/60">{new Date(replay.current.ts).toLocaleString()}</span>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{
                        background: replay.current.event_type === "KILL_SWITCH" ? `color-mix(in srgb, ${BREAK} 12%, transparent)` : `color-mix(in srgb, ${GO} 12%, transparent)`,
                        color: replay.current.event_type === "KILL_SWITCH" ? BREAK : GO,
                      }}>{replay.current.event_type}</span>
                    </div>
                    {replay.current.netuid != null && (
                      <div className="font-mono text-[10px] text-muted-foreground/40">SN-{replay.current.netuid}</div>
                    )}
                    {replay.current.decision_reason && (
                      <div className="font-mono text-[10px] text-muted-foreground/55 italic">{replay.current.decision_reason}</div>
                    )}
                    {replay.current.data_confidence != null && (
                      <div className="font-mono text-[10px] text-muted-foreground/30">
                        Confidence: {replay.current.data_confidence}%
                        {replay.current.kill_switch_active && " · 🛡 SAFE MODE"}
                      </div>
                    )}
                    <details className="mt-1">
                      <summary className="font-mono text-[9px] text-muted-foreground/20 cursor-pointer">{fr ? "Détail JSON" : "JSON detail"}</summary>
                      <pre className="font-mono text-[8px] text-muted-foreground/20 mt-1 max-h-32 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify({ inputs: replay.current.inputs, outputs: replay.current.outputs }, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )}

            {replay.total === 0 && !replay.isLoading && (
              <p className="font-mono text-[10px] text-muted-foreground/20 text-center py-2">
                {fr ? "Aucune entrée. Lancez le chargement." : "No entries. Load data first."}
              </p>
            )}
          </div>
        </SectionCard>

        {/* ── 4. BACKTEST ── */}
        <SectionCard>
          <SectionTitle icon="📊" title={fr ? "Backtest moteur" : "Engine Backtest"} />
          <div className="px-5 py-4 space-y-3">
            <p className="font-mono text-[10px] text-muted-foreground/35">
              {fr ? "Rejoue la DecisionLayer sur les snapshots historiques." : "Replays the DecisionLayer on historical snapshots."}
            </p>
            <BacktestPanel />
          </div>
        </SectionCard>

        {/* ── 5. PUSH LOGS ── */}
        <SectionCard>
          <SectionTitle icon="📡" title="Push Logs" />
          <div className="px-5 py-4 space-y-3">
            <p className="font-mono text-[10px] text-muted-foreground/35">
              {fr ? "Historique des notifications push : statut, priorité, retries." : "Push notification history: status, priority, retries."}
            </p>
            <PushLogDashboard />
          </div>
        </SectionCard>

        {/* ── 6. DEBUG MODE ── */}
        <SectionCard>
          <SectionTitle icon="🧪" title={fr ? "Mode Debug" : "Debug Mode"} />
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-muted-foreground/40">
                {fr ? "Activer les outils de diagnostic avancé" : "Enable advanced diagnostic tools"}
              </span>
              <button
                onClick={() => {
                  const next = !debugMode;
                  localStorage.setItem("DEBUG_MODE", String(next));
                  setDebugMode(next);
                }}
                className="font-mono text-[10px] px-3 py-1.5 rounded-lg transition-all border"
                style={{
                  background: debugMode ? `color-mix(in srgb, ${GO} 10%, transparent)` : "transparent",
                  color: debugMode ? GO : "hsl(var(--muted-foreground))",
                  borderColor: debugMode ? `color-mix(in srgb, ${GO} 25%, transparent)` : "hsl(var(--border))",
                  opacity: debugMode ? 1 : 0.4,
                }}>
                {debugMode ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
