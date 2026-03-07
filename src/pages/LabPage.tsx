import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import ToolsPanel from "@/components/lab/ToolsPanel";
import RadarPage from "./RadarPage";
import MethodologyPage from "./MethodologyPage";
import QuantDiagnosticsPage from "./QuantDiagnosticsPage";

/* ═══════════════════════════════════════════════════════ */
/*   LAB — Expert Tools & Diagnostics                      */
/* ═══════════════════════════════════════════════════════ */

const GOLD = "hsl(var(--gold))";

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
                className="flex-1 flex items-center justify-center gap-1 px-2 py-2.5 sm:px-4 sm:py-3 font-mono text-[9px] sm:text-[10px] tracking-wider transition-all relative"
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
