import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import RadarPage from "./RadarPage";
import MethodologyPage from "./MethodologyPage";
import QuantDiagnosticsPage from "./QuantDiagnosticsPage";

/* ═══════════════════════════════════════ */
/*   LAB — Advanced Diagnostics Terminal   */
/*   Hosts Radar, Methodology, Quant       */
/* ═══════════════════════════════════════ */

const TABS = [
  { key: "radar", icon: "📡", label_fr: "Radar Intelligence", label_en: "Radar Intelligence" },
  { key: "quant", icon: "🔬", label_fr: "Diagnostics Quant", label_en: "Quant Diagnostics" },
  { key: "methodology", icon: "📖", label_fr: "Méthodologie", label_en: "Methodology" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function LabPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const [activeTab, setActiveTab] = useState<TabKey>("radar");

  return (
    <div className="h-full w-full bg-background text-foreground overflow-hidden flex flex-col">
      {/* ── Tab Bar ── */}
      <div
        className="flex-shrink-0 border-b overflow-x-auto"
        style={{ borderColor: "hsla(0,0%,100%,0.06)" }}
      >
        <div className="flex min-w-max px-2">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabKey)}
                className="flex items-center gap-1.5 px-4 py-3 font-mono text-[10px] tracking-wider transition-all relative"
                style={{
                  color: active ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
                  opacity: active ? 1 : 0.5,
                }}
              >
                <span className="text-xs">{tab.icon}</span>
                <span>{fr ? tab.label_fr : tab.label_en}</span>
                {active && (
                  <span
                    className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                    style={{ background: "hsl(var(--gold))" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "radar" && <RadarPage />}
        {activeTab === "quant" && <QuantDiagnosticsPage />}
        {activeTab === "methodology" && <MethodologyPage />}
      </div>
    </div>
  );
}
