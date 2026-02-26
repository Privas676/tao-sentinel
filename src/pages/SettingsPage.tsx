import { useI18n, Lang } from "@/lib/i18n";

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();

  return (
    <div className="h-full w-full bg-[#000] text-white p-6 overflow-auto">
      <h1 className="font-mono text-lg tracking-widest text-white/80 mb-8">{t("settings.title")}</h1>

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
