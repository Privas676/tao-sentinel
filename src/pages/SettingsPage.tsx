import { useState } from "react";
import { useI18n, Lang } from "@/lib/i18n";
import { useOverrideMode } from "@/hooks/use-override-mode";
import { useDelistMode } from "@/hooks/use-delist-mode";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import type { DelistMode } from "@/lib/delist-risk";

/* ═══════════════════════════════════════════════════════ */
/*   SETTINGS — Clean User Preferences                     */
/* ═══════════════════════════════════════════════════════ */

const GOLD = "hsl(var(--gold))";
const GO = "hsl(var(--signal-go))";
const WARN = "hsl(var(--signal-go-spec))";
const BREAK = "hsl(var(--signal-break))";

function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card">{children}</div>;
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border">
      <span className="text-sm opacity-70">{icon}</span>
      <h2 className="font-mono text-[10px] tracking-[0.15em] uppercase text-gold">{title}</h2>
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-4 px-5 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] text-foreground/70 font-medium">{label}</div>
        {description && <div className="font-mono text-[9px] text-muted-foreground/35 mt-0.5 max-w-sm">{description}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function ToggleButtons<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; color?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-border">
      {options.map(opt => {
        const active = value === opt.value;
        const color = opt.color || GOLD;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)}
            className="font-mono text-[10px] tracking-wider px-3 py-1.5 transition-all"
            style={{
              background: active ? `color-mix(in srgb, ${color} 10%, transparent)` : "transparent",
              color: active ? color : "hsl(var(--muted-foreground))",
              fontWeight: active ? 700 : 400,
              opacity: active ? 1 : 0.4,
            }}>
            {opt.label}
          </button>
        );
      })}
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
          <p className="font-mono text-[10px] text-muted-foreground/45 mt-1 leading-relaxed">
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
            <div className="font-mono text-[10px] text-muted-foreground/50 text-right">
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
              <span className="font-mono text-[10px] text-destructive/60">🔇 {fr ? "Bloqué par le navigateur" : "Blocked by browser"}</span>
            ) : pushState === "unsupported" ? (
              <span className="font-mono text-[10px] text-muted-foreground/30">{fr ? "Non supporté" : "Not supported"}</span>
            ) : pushState === "loading" ? (
              <span className="font-mono text-[10px] text-muted-foreground/30 animate-pulse">…</span>
            ) : (
              <button onClick={pushSubscribe}
                className="font-mono text-[10px] px-3 py-1.5 rounded-lg border border-border text-muted-foreground/40 hover:text-gold transition-all">
                🔕 {fr ? "Activer" : "Enable"}
              </button>
            )}
          </SettingRow>
        </SectionCard>

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
                <span className="font-mono text-[10px] text-muted-foreground/50">{t.label}</span>
                <span className="font-mono text-[10px] font-medium" style={{ color: t.color }}>{t.range}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ── TMC context note ── */}
        <div className="font-mono text-[9px] text-muted-foreground/25 text-center px-4 leading-relaxed">
          {fr
            ? "TMC est affiché en lecture seule. Il n'influence ni le scoring, ni les alertes, ni les overrides."
            : "TMC is displayed read-only. It does not affect scoring, alerts, or overrides."}
        </div>
      </div>
    </div>
  );
}
