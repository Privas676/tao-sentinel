import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router-dom";
import {
  deriveGaugeState, derivePhase, deriveTMinus, formatTimeClear, stateColor,
  GaugeState, GaugePhase, opportunityColor, riskColor, clamp,
} from "@/lib/gauge-engine";

type SignalRow = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  mpi: number | null;
  score: number | null;
  confidence_pct: number | null;
  quality_score: number | null;
  ts: string | null;
};

type ViewMode = "all" | "opportunities" | "risks";
const PHASE_OPTIONS: (GaugePhase | "ALL")[] = ["ALL", "BUILD", "ARMED", "TRIGGER"];

function deriveOpp(psi: number, conf: number, quality: number, state: string | null): number {
  let opp = 0;
  opp += clamp(psi * 0.45, 0, 45);
  opp += clamp(conf * 0.25, 0, 25);
  opp += clamp(quality * 0.20, 0, 20);
  if (state === "GO" || state === "GO_SPECULATIVE") opp += 10;
  return Math.round(clamp(opp, 0, 100));
}

function deriveRisk(psi: number, conf: number, quality: number, state: string | null): number {
  let risk = 0;
  if (state === "BREAK" || state === "EXIT_FAST") risk += 45;
  risk += clamp((100 - quality) * 0.25, 0, 25);
  risk += clamp((100 - conf) * 0.15, 0, 15);
  if (psi >= 85) risk += clamp((psi - 85) * 1.5, 0, 15);
  return Math.round(clamp(risk, 0, 100));
}

export default function SubnetsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ViewMode>("all");
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
        const quality = s.quality_score ?? 0;
        const isBreak = s.state === "BREAK" || s.state === "EXIT_FAST";
        const state = deriveGaugeState(psi, conf, isBreak);
        const phase = derivePhase(psi);
        const tMinus = deriveTMinus(psi);
        const opp = deriveOpp(psi, conf, quality, s.state);
        const risk = deriveRisk(psi, conf, quality, s.state);
        return { netuid: s.netuid!, name: s.subnet_name || `SN-${s.netuid}`, psi, conf, state, phase, tMinus, opp, risk };
      })
      .filter(r => {
        if (mode === "opportunities") return r.opp > r.risk;
        if (mode === "risks") return r.risk >= r.opp;
        return true;
      })
      .filter(r => phaseFilter === "ALL" || r.phase === phaseFilter)
      .sort((a, b) => mode === "risks" ? b.risk - a.risk : b.opp - a.opp);
  }, [signals, mode, phaseFilter]);

  const modeOptions: { value: ViewMode; label: string }[] = [
    { value: "all", label: t("sub.mode_all") },
    { value: "opportunities", label: t("sub.mode_opp") },
    { value: "risks", label: t("sub.mode_risk") },
  ];

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <h1 className="font-mono text-lg sm:text-xl tracking-widest text-white/85 mb-5 sm:mb-7">{t("sub.title")}</h1>

      {/* Simplified filters: Mode + Phase */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Mode selector */}
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {modeOptions.map(opt => (
            <button key={opt.value}
              onClick={() => setMode(opt.value)}
              className="font-mono text-[11px] tracking-wider px-4 py-2 transition-all"
              style={{
                background: mode === opt.value ? "rgba(255,215,0,0.1)" : "transparent",
                color: mode === opt.value ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.35)",
                fontWeight: mode === opt.value ? 700 : 400,
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Phase dropdown */}
        <select value={phaseFilter}
          onChange={(e) => setPhaseFilter(e.target.value as GaugePhase | "ALL")}
          className="font-mono text-[11px] tracking-wider px-3 py-2 rounded-lg bg-transparent transition-all"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.5)",
            appearance: "none",
            minWidth: 160,
          }}>
          <option value="ALL" className="bg-[#0a0a0f]">{t("sub.phase_all")}</option>
          {(["BUILD", "ARMED", "TRIGGER"] as GaugePhase[]).map(p => (
            <option key={p} value={p} className="bg-[#0a0a0f]">{t(`phase.${p.toLowerCase()}` as any)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b border-white/10 text-white/40">
              <th className="text-left py-3 px-3">SN</th>
              <th className="text-left py-3 px-3">{t("sub.name")}</th>
              <th className="text-right py-3 px-3">{t("sub.opp")}</th>
              <th className="text-right py-3 px-3">{t("sub.risk")}</th>
              <th className="text-center py-3 px-3">{t("sub.state")}</th>
              <th className="text-center py-3 px-3">{t("sub.phase")}</th>
              <th className="text-right py-3 px-3">{t("sub.tminus")}</th>
              <th className="text-right py-3 px-3">{t("sub.confidence")}</th>
              {user && <th className="text-center py-3 px-3"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const stColor = stateColor(r.state);
              const oppC = opportunityColor(r.opp);
              const rskC = riskColor(r.risk);
              return (
                <tr key={r.netuid}
                  className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer"
                  onClick={() => window.open(`https://taostats.io/subnets/${r.netuid}`, "_blank")}>
                  <td className="py-3 px-3 text-white/55 text-sm">{r.netuid}</td>
                  <td className="py-3 px-3 text-white/75 text-sm">{r.name}</td>
                  <td className="py-3 px-3 text-right font-bold text-sm" style={{ color: oppC }}>{r.opp}</td>
                  <td className="py-3 px-3 text-right font-bold text-sm" style={{ color: rskC }}>{r.risk}</td>
                  <td className="py-3 px-3 text-center">
                    <span className="inline-block px-2.5 py-1 rounded text-[11px] tracking-wider font-semibold" style={{ color: stColor, border: `1px solid ${stColor}33` }}>
                      {t(`state.${r.state.toLowerCase()}` as any)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center text-white/45 text-sm">
                    {r.phase !== "NONE" ? t(`phase.${r.phase.toLowerCase()}` as any) : "—"}
                  </td>
                  <td className="py-3 px-3 text-right text-white/55 text-sm">{formatTimeClear(r.tMinus)}</td>
                  <td className="py-3 px-3 text-right text-white/55 text-sm">{r.conf}%</td>
                  {user && (
                    <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => navigate(`/?open=${r.netuid}`)}
                        className="font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-md transition-all"
                        style={{
                          background: "rgba(255,215,0,0.08)",
                          color: "rgba(255,215,0,0.7)",
                          border: "1px solid rgba(255,215,0,0.15)",
                        }}>
                        {t("sub.open_pos")}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
