import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { deriveGaugeState, derivePhase, deriveTMinus, formatTMinus, stateColor, GaugeState, GaugePhase } from "@/lib/gauge-engine";

type SignalRow = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  mpi: number | null;
  score: number | null;
  confidence_pct: number | null;
  ts: string | null;
};

const STATE_FILTERS: GaugeState[] = ["CALM", "ALERT", "IMMINENT", "EXIT"];
const PHASE_FILTERS: GaugePhase[] = ["BUILD", "ARMED", "TRIGGER"];

export default function SubnetsPage() {
  const { t } = useI18n();
  const [stateFilter, setStateFilter] = useState<GaugeState | "ALL">("ALL");
  const [phaseFilter, setPhaseFilter] = useState<GaugePhase | "ALL">("ALL");

  const { data: signals } = useQuery({
    queryKey: ["signals-latest-table"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as SignalRow[];
    },
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    if (!signals) return [];
    return signals
      .filter(s => s.netuid != null)
      .map(s => {
        const psi = s.mpi ?? s.score ?? 0;
        const conf = s.confidence_pct ?? 0;
        const isBreak = s.state === "BREAK" || s.state === "EXIT_FAST";
        const state = deriveGaugeState(psi, conf, isBreak);
        const phase = derivePhase(psi);
        const tMinus = deriveTMinus(psi);
        return {
          netuid: s.netuid!,
          name: s.subnet_name || `SN-${s.netuid}`,
          psi, conf, state, phase, tMinus,
        };
      })
      .filter(r => stateFilter === "ALL" || r.state === stateFilter)
      .filter(r => phaseFilter === "ALL" || r.phase === phaseFilter)
      .sort((a, b) => b.psi - a.psi);
  }, [signals, stateFilter, phaseFilter]);

  return (
    <div className="h-full w-full bg-[#000] text-white p-6 overflow-auto">
      <h1 className="font-mono text-lg tracking-widest text-white/80 mb-6">{t("sub.title")}</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <FilterBtn label={t("filter.all")} active={stateFilter === "ALL"} onClick={() => setStateFilter("ALL")} />
        {STATE_FILTERS.map(s => (
          <FilterBtn key={s} label={t(`state.${s.toLowerCase()}` as any)} active={stateFilter === s}
            onClick={() => setStateFilter(s)} color={stateColor(s)} />
        ))}
        <div className="w-px bg-white/10 mx-2" />
        <FilterBtn label={t("filter.all")} active={phaseFilter === "ALL"} onClick={() => setPhaseFilter("ALL")} />
        {PHASE_FILTERS.map(p => (
          <FilterBtn key={p} label={t(`phase.${p.toLowerCase()}` as any)} active={phaseFilter === p}
            onClick={() => setPhaseFilter(p)} />
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b border-white/10 text-white/30">
              <th className="text-left py-3 px-3">SN</th>
              <th className="text-left py-3 px-3">{t("sub.name")}</th>
              <th className="text-right py-3 px-3">{t("sub.psi")}</th>
              <th className="text-center py-3 px-3">{t("sub.state")}</th>
              <th className="text-center py-3 px-3">{t("sub.phase")}</th>
              <th className="text-right py-3 px-3">{t("sub.confidence")}</th>
              <th className="text-right py-3 px-3">{t("sub.tminus")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const color = stateColor(r.state);
              return (
                <tr key={r.netuid} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                  onClick={() => window.open(`https://taostats.io/subnets/${r.netuid}`, "_blank")}>
                  <td className="py-2.5 px-3 text-white/50">{r.netuid}</td>
                  <td className="py-2.5 px-3 text-white/70">{r.name}</td>
                  <td className="py-2.5 px-3 text-right font-semibold" style={{ color }}>{r.psi}</td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] tracking-wider" style={{ color, border: `1px solid ${color}33` }}>
                      {t(`state.${r.state.toLowerCase()}` as any)}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center text-white/40">
                    {r.phase !== "NONE" ? t(`phase.${r.phase.toLowerCase()}` as any) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right text-white/50">{r.conf}%</td>
                  <td className="py-2.5 px-3 text-right text-white/50">{formatTMinus(r.tMinus)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterBtn({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-md transition-all"
      style={{
        background: active ? "rgba(255,255,255,0.08)" : "transparent",
        color: active ? (color || "rgba(255,255,255,0.8)") : "rgba(255,255,255,0.3)",
        border: `1px solid ${active ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)"}`,
      }}
    >
      {label}
    </button>
  );
}
