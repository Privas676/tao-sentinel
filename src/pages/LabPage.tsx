import { useState } from "react";
import { useI18n } from "@/lib/i18n";

/* ═══════════════════════════════════════ */
/*   LAB — Advanced Diagnostics Terminal   */
/*   Replaces Radar, Methodology, Quant    */
/* ═══════════════════════════════════════ */

const TABS = [
  { key: "capital", icon: "💰", label_fr: "Capital Flow", label_en: "Capital Flow" },
  { key: "risk", icon: "🛡️", label_fr: "Risk Monitor", label_en: "Risk Monitor" },
  { key: "amm", icon: "⚖️", label_fr: "AMM / Pricing", label_en: "AMM / Pricing" },
  { key: "economics", icon: "📊", label_fr: "Fondamentaux", label_en: "Economics" },
  { key: "smart", icon: "🐋", label_fr: "Smart Money", label_en: "Smart Money" },
  { key: "validators", icon: "⛓️", label_fr: "Validateurs", label_en: "Validators" },
  { key: "heatmap", icon: "🗺️", label_fr: "Heatmap", label_en: "Heatmap" },
  { key: "methodology", icon: "📖", label_fr: "Méthodologie", label_en: "Methodology" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function TabPlaceholder({ tabKey, fr }: { tabKey: TabKey; fr: boolean }) {
  const tab = TABS.find((t) => t.key === tabKey)!;
  const label = fr ? tab.label_fr : tab.label_en;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xl">{tab.icon}</span>
        <h2 className="font-mono text-sm tracking-widest uppercase" style={{ color: "hsl(var(--gold))" }}>
          {label}
        </h2>
      </div>
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: "linear-gradient(135deg, hsla(0,0%,100%,0.02) 0%, hsla(0,0%,100%,0.005) 100%)",
          border: "1px dashed hsla(0,0%,100%,0.08)",
        }}
      >
        <span className="text-3xl block mb-3">{tab.icon}</span>
        <p className="font-mono text-[11px] text-muted-foreground/50">
          {fr
            ? `Module ${label} — implémentation à venir`
            : `${label} module — implementation coming soon`
          }
        </p>
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-20 rounded-lg animate-pulse"
              style={{ background: "hsla(0,0%,100%,0.02)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LabPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const [activeTab, setActiveTab] = useState<TabKey>("capital");

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
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-3 py-3 font-mono text-[10px] tracking-wider transition-all relative"
                style={{
                  color: active ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
                  opacity: active ? 1 : 0.5,
                }}
              >
                <span className="text-xs">{tab.icon}</span>
                <span className="hidden sm:inline">{fr ? tab.label_fr : tab.label_en}</span>
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
      <div className="flex-1 overflow-auto">
        <TabPlaceholder tabKey={activeTab} fr={fr} />
      </div>
    </div>
  );
}
