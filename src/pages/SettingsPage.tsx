import { useState } from "react";
import { useI18n, Lang } from "@/lib/i18n";
import { useOverrideMode } from "@/hooks/use-override-mode";
import { useDelistMode } from "@/hooks/use-delist-mode";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { SectionCard, SectionTitle, SettingRow, ToggleButtons } from "@/components/settings/SettingsShared";
import InstallSection from "@/components/settings/InstallSection";
import SystemDiagnostics from "@/components/settings/SystemDiagnostics";
import type { DelistMode } from "@/lib/delist-risk";
import { APP_VERSION, BUILD_TAG } from "@/lib/version";


/* ═══════════════════════════════════════════════════════ */
/*   SETTINGS — Clean User Preferences                     */
/* ═══════════════════════════════════════════════════════ */

const GO = "hsl(var(--signal-go))";
const WARN = "hsl(var(--signal-go-spec))";
const BREAK = "hsl(var(--signal-break))";

function PushDiagRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
      <span className={`font-mono text-[10px] font-medium ${ok ? "text-foreground" : "text-muted-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { lang, setLang } = useI18n();
  const fr = lang === "fr";
  const { mode, setMode } = useOverrideMode();
  const { delistMode, setDelistMode } = useDelistMode();
  const { state: pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications();
  const [density, setDensity] = useState<"compact" | "normal">(() => {
    try { return (localStorage.getItem("display_density") as "compact" | "normal") || "normal"; } catch { return "normal"; }
  });

  // Push alert preferences
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(() => {
    try { return Number(localStorage.getItem("push_confidence_threshold")) || 50; } catch { return 50; }
  });

  type AlertType = "GO" | "BREAK" | "EXIT_FAST" | "EARLY" | "DEPEG_WARNING" | "DEPEG_CRITICAL" | "RISK_OVERRIDE" | "CONFIDENCE_DROP" | "POSITION_URGENT" | "WHALE_MOVE" | "SMART_ACCUMULATION";
  const ALL_ALERT_TYPES: { key: AlertType; label: string; labelEn: string; icon: string }[] = [
    { key: "GO", label: "Signal GO", labelEn: "GO Signal", icon: "🟢" },
    { key: "BREAK", label: "Zone critique", labelEn: "Critical zone", icon: "🔴" },
    { key: "EXIT_FAST", label: "Sortie urgente", labelEn: "Urgent exit", icon: "🚨" },
    { key: "EARLY", label: "Signal précoce", labelEn: "Early signal", icon: "🌱" },
    { key: "DEPEG_WARNING", label: "Alerte depeg", labelEn: "Depeg warning", icon: "⚠️" },
    { key: "DEPEG_CRITICAL", label: "Depeg critique", labelEn: "Critical depeg", icon: "💀" },
    { key: "RISK_OVERRIDE", label: "Override risque", labelEn: "Risk override", icon: "🛡" },
    { key: "CONFIDENCE_DROP", label: "Chute confiance", labelEn: "Confidence drop", icon: "📉" },
    { key: "POSITION_URGENT", label: "Position urgente", labelEn: "Urgent position", icon: "🎯" },
    { key: "WHALE_MOVE", label: "Mouvement whale", labelEn: "Whale move", icon: "🐋" },
    { key: "SMART_ACCUMULATION", label: "Accumulation smart", labelEn: "Smart accumulation", icon: "🧠" },
  ];

  const [enabledAlerts, setEnabledAlerts] = useState<Set<AlertType>>(() => {
    try {
      const stored = localStorage.getItem("push_enabled_alerts");
      if (stored) return new Set(JSON.parse(stored) as AlertType[]);
    } catch { /* fallback */ }
    return new Set(ALL_ALERT_TYPES.map(a => a.key));
  });

  const handleThresholdChange = (val: number) => {
    setConfidenceThreshold(val);
    localStorage.setItem("push_confidence_threshold", String(val));
  };

  const toggleAlert = (key: AlertType) => {
    setEnabledAlerts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem("push_enabled_alerts", JSON.stringify([...next]));
      return next;
    });
  };

  const allEnabled = enabledAlerts.size === ALL_ALERT_TYPES.length;
  const toggleAll = () => {
    if (allEnabled) {
      setEnabledAlerts(new Set());
      localStorage.setItem("push_enabled_alerts", "[]");
    } else {
      const all = new Set(ALL_ALERT_TYPES.map(a => a.key));
      setEnabledAlerts(all);
      localStorage.setItem("push_enabled_alerts", JSON.stringify([...all]));
    }
  };

  const handleDensity = (d: "compact" | "normal") => {
    setDensity(d);
    localStorage.setItem("display_density", d);
  };

  return (
    <div className="h-full w-full bg-background text-foreground overflow-auto pb-8">
      <div className="px-4 sm:px-6 py-5 max-w-[700px] mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="font-mono text-lg sm:text-xl tracking-wider text-gold">
            {fr ? "Réglages" : "Settings"}
          </h1>
          <p className="font-mono text-[10px] text-muted-foreground mt-1 leading-relaxed">
            {fr ? "Préférences d'affichage, notifications et comportement du moteur." : "Display preferences, notifications and engine behavior."}
          </p>
        </div>

        {/* ── 1. GENERAL ── */}
        <SectionCard>
          <SectionTitle icon="🌐" title={fr ? "Général" : "General"} />

          <SettingRow label={fr ? "Langue" : "Language"} description={fr ? "Langue de l'interface" : "Interface language"}>
            <ToggleButtons
              options={[
                { value: "fr" as Lang, label: "Français" },
                { value: "en" as Lang, label: "English" },
              ]}
              value={lang}
              onChange={setLang}
            />
          </SettingRow>

          <SettingRow label={fr ? "Densité d'affichage" : "Display density"} description={fr ? "Espacement des tableaux et cartes" : "Spacing for tables and cards"}>
            <ToggleButtons
              options={[
                { value: "compact" as const, label: fr ? "Compact" : "Compact" },
                { value: "normal" as const, label: "Normal" },
              ]}
              value={density}
              onChange={handleDensity}
            />
          </SettingRow>

          <SettingRow label={fr ? "Fréquence de rafraîchissement" : "Refresh frequency"} description={fr ? "Intervalles de mise à jour des données" : "Data update intervals"}>
            <div className="font-mono text-[10px] text-muted-foreground text-right">
              <div>Signals: 60s</div>
              <div>Sparklines: 300s</div>
            </div>
          </SettingRow>
        </SectionCard>

        {/* ── 2. NOTIFICATIONS ── */}
        <SectionCard>
          <SectionTitle icon="🔔" title="Notifications" />

          <SettingRow
            label={fr ? "Notifications push" : "Push notifications"}
            description={fr ? "Alertes critiques en temps réel sur votre appareil" : "Real-time critical alerts on your device"}
          >
            {pushState === "subscribed" ? (
              <button onClick={pushUnsubscribe}
                className="font-mono text-[10px] px-3 py-1.5 rounded-lg transition-all border"
                style={{ borderColor: `color-mix(in srgb, ${GO} 25%, transparent)`, color: GO, background: `color-mix(in srgb, ${GO} 8%, transparent)` }}>
                🔔 {fr ? "Activé" : "Enabled"} ✓
              </button>
            ) : pushState === "denied" ? (
              <span className="font-mono text-[10px] text-destructive">🔇 {fr ? "Bloqué par le navigateur" : "Blocked by browser"}</span>
            ) : pushState === "unsupported" ? (
              <span className="font-mono text-[10px] text-muted-foreground">{fr ? "Non supporté sur ce navigateur" : "Not supported on this browser"}</span>
            ) : pushState === "loading" ? (
              <span className="font-mono text-[10px] text-muted-foreground animate-pulse">…</span>
            ) : (
              <button onClick={pushSubscribe}
                className="font-mono text-[10px] px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-gold transition-all">
                🔕 {fr ? "Activer" : "Enable"}
              </button>
            )}
          </SettingRow>

          {/* Push Diagnostics Status */}
          <div className="px-5 py-3 border-b border-border last:border-0">
            <div className="font-mono text-[9px] tracking-widest uppercase text-muted-foreground mb-2">
              {fr ? "DIAGNOSTIC PUSH" : "PUSH DIAGNOSTICS"}
            </div>
            <div className="space-y-1.5">
              <PushDiagRow
                label={fr ? "Permission navigateur" : "Browser permission"}
                value={
                  typeof Notification !== "undefined"
                    ? Notification.permission === "granted" ? "✅ granted"
                      : Notification.permission === "denied" ? "❌ denied"
                      : "⏳ prompt"
                    : "❌ unavailable"
                }
                ok={typeof Notification !== "undefined" && Notification.permission === "granted"}
              />
              <PushDiagRow
                label="Service Worker"
                value={"serviceWorker" in navigator ? "✅ supported" : "❌ unsupported"}
                ok={"serviceWorker" in navigator}
              />
              <PushDiagRow
                label={fr ? "Abonnement push" : "Push subscription"}
                value={pushState === "subscribed" ? "✅ active" : pushState === "unsubscribed" ? "⚪ inactive" : pushState === "denied" ? "❌ blocked" : pushState === "unsupported" ? "❌ unavailable" : "⏳ checking"}
                ok={pushState === "subscribed"}
              />
              <PushDiagRow
                label={fr ? "Statut global" : "Overall status"}
                value={
                  pushState === "subscribed" ? (fr ? "✅ Opérationnel" : "✅ Operational")
                  : pushState === "unsupported" ? (fr ? "❌ Indisponible" : "❌ Unavailable")
                  : pushState === "denied" ? (fr ? "❌ Bloqué" : "❌ Blocked")
                  : (fr ? "⚠️ Non activé" : "⚠️ Not enabled")
                }
                ok={pushState === "subscribed"}
              />
            </div>
          </div>
        </SectionCard>

        {/* ── 2a. PUSH ALERT CONFIG ── */}
        <SectionCard>
          <SectionTitle icon="⚙" title={fr ? "Configuration alertes push" : "Push alert config"}
            badge={<span className="font-mono text-[8px] text-muted-foreground">{enabledAlerts.size}/{ALL_ALERT_TYPES.length}</span>}
          />

          {/* Confidence threshold slider */}
          <SettingRow
            label={fr ? "Seuil de confiance critique" : "Critical confidence threshold"}
            description={fr
              ? `Alerte si la confiance globale descend sous ${confidenceThreshold}%`
              : `Alert when global confidence drops below ${confidenceThreshold}%`}
          >
            <div className="flex items-center gap-3">
              <input
                type="range" min={20} max={80} step={5}
                value={confidenceThreshold}
                onChange={e => handleThresholdChange(Number(e.target.value))}
                className="w-24 sm:w-32 h-1.5 accent-gold cursor-pointer"
                style={{ accentColor: "hsl(var(--gold))" }}
              />
              <span className="font-mono text-[11px] font-bold min-w-[3ch] text-right" style={{ color: "hsl(var(--gold))" }}>
                {confidenceThreshold}%
              </span>
            </div>
          </SettingRow>

          {/* Alert type toggles */}
          <div className="px-5 py-3 border-b border-border last:border-0">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-[11px] text-foreground/70 font-medium">
                {fr ? "Types d'alertes à recevoir" : "Alert types to receive"}
              </span>
              <button onClick={toggleAll}
                className="font-mono text-[9px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-gold transition-all">
                {allEnabled ? (fr ? "Tout désactiver" : "Disable all") : (fr ? "Tout activer" : "Enable all")}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {ALL_ALERT_TYPES.map(at => {
                const on = enabledAlerts.has(at.key);
                return (
                  <button key={at.key} onClick={() => toggleAlert(at.key)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all font-mono text-[10px]"
                    style={{
                      background: on ? "hsla(var(--gold), 0.06)" : "transparent",
                      color: on ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                      opacity: on ? 1 : 0.45,
                      border: `1px solid ${on ? "hsla(var(--gold), 0.15)" : "hsla(var(--border), 0.5)"}`,
                    }}>
                    <span style={{ fontSize: 12 }}>{at.icon}</span>
                    <span className="flex-1 truncate">{fr ? at.label : at.labelEn}</span>
                    <span className="text-[8px]" style={{ color: on ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))" }}>
                      {on ? "ON" : "OFF"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </SectionCard>

        {/* ── 2b. INSTALL ── */}
        <InstallSection fr={fr} />

        {/* ── 3. ENGINE BEHAVIOR ── */}
        <SectionCard>
          <SectionTitle icon="⚙" title={fr ? "Comportement moteur" : "Engine behavior"} />

          <SettingRow
            label={fr ? "Mode Override" : "Override mode"}
            description={mode === "strict"
              ? (fr ? "Risk ≥ 70 + Confiance ≥ 70% + ≥ 2 signaux critiques. Max 10." : "Risk ≥ 70 + Confidence ≥ 70% + ≥ 2 critical signals. Max 10.")
              : (fr ? "Toutes les alertes override affichées (legacy)." : "All override alerts shown (legacy).")}
          >
            <ToggleButtons
              options={[
                { value: "strict" as const, label: "🛡 Strict", color: GO },
                { value: "permissive" as const, label: fr ? "⚡ Permissif" : "⚡ Permissive", color: WARN },
              ]}
              value={mode}
              onChange={setMode}
            />
          </SettingRow>

          <SettingRow
            label={fr ? "Détection Depeg / Delist" : "Depeg / Delist detection"}
            description={fr ? "Source des données de risque de désenregistrement" : "Source for deregistration risk data"}
          >
            <ToggleButtons
              options={[
                { value: "manual" as DelistMode, label: fr ? "📋 Manuel" : "📋 Manual" },
                { value: "auto_taostats" as DelistMode, label: "🤖 Auto" },
              ]}
              value={delistMode}
              onChange={setDelistMode}
            />
          </SettingRow>
        </SectionCard>

        {/* ── 4. THRESHOLDS (read-only) ── */}
        <SectionCard>
          <SectionTitle icon="📊" title={fr ? "Seuils de référence" : "Reference thresholds"} />
          <div className="px-5 py-3 space-y-0">
            {[
              { label: "BUILD", range: "PSI 35–55", color: "hsl(var(--muted-foreground))" },
              { label: "ARMED", range: "PSI 55–70", color: WARN },
              { label: "TRIGGER", range: "PSI 70–85", color: GO },
              { label: "IMMINENT", range: "PSI > 85 + Conf > 70%", color: GO },
              { label: "EXIT", range: "Risk > 70", color: BREAK },
            ].map(t => (
              <div key={t.label} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                <span className="font-mono text-[10px] text-muted-foreground">{t.label}</span>
                <span className="font-mono text-[10px] font-medium" style={{ color: t.color }}>{t.range}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ── 5. SYSTEM DIAGNOSTICS ── */}
        <SystemDiagnostics fr={fr} />

        {/* ── TMC context note ── */}
        <div className="font-mono text-[9px] text-muted-foreground text-center px-4 leading-relaxed">
          {fr
            ? "TMC est affiché en lecture seule. Il n'influence ni le scoring, ni les alertes, ni les overrides."
            : "TMC is displayed read-only. It does not affect scoring, alerts, or overrides."}
        </div>

        {/* ── Version footer ── */}
        <div className="text-center pt-2">
          <span className="font-mono text-[8px] text-muted-foreground/40 tracking-wider">
            TAO Sentinel {APP_VERSION} · {BUILD_TAG}
          </span>
        </div>

      </div>
    </div>
  );
}
