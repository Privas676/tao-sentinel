import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useMemo } from "react";

type EventRow = {
  id: number;
  netuid: number | null;
  type: string | null;
  severity: number | null;
  ts: string | null;
  evidence: any;
};

export default function AlertsPage() {
  const { t } = useI18n();

  const { data: events } = useQuery({
    queryKey: ["events-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("ts", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as EventRow[];
    },
    refetchInterval: 60_000,
  });

  // Deduplicate: keep only latest event per (netuid, type) combo
  const deduped = useMemo(() => {
    if (!events) return [];
    const seen = new Map<string, EventRow>();
    for (const ev of events) {
      const key = `${ev.netuid ?? "null"}-${ev.type}`;
      if (!seen.has(key)) seen.set(key, ev);
    }
    return Array.from(seen.values());
  }, [events]);

  const severityColor = (sev: number | null) => {
    if (!sev || sev <= 1) return "rgba(84,110,122,0.7)";
    if (sev === 2) return "rgba(251,192,45,0.7)";
    if (sev === 3) return "rgba(255,109,0,0.8)";
    return "rgba(229,57,53,0.8)";
  };

  const renderWhaleEvent = (ev: EventRow) => {
    const e = ev.evidence as any;
    const dir = e?.direction === "OUT" ? "↗" : "↙";
    const dirColor = e?.direction === "OUT" ? "rgba(229,57,53,0.8)" : "rgba(76,175,80,0.8)";
    const label = e?.label || "Whale";
    const amount = e?.amount_tao ? `${Number(e.amount_tao).toLocaleString()} τ` : "—";
    return (
      <div key={ev.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 border border-white/[0.04] rounded-lg hover:bg-white/[0.02] transition-colors">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: severityColor(ev.severity) }} />
        <span className="font-mono text-sm" style={{ color: dirColor }}>{dir}</span>
        <div className="font-mono text-xs tracking-wider font-bold" style={{ color: "rgba(255,215,0,0.8)" }}>🐋 {label}</div>
        <div className="font-mono text-xs font-bold" style={{ color: dirColor }}>{e?.direction === "OUT" ? "SORTIE" : "ENTRÉE"} {amount}</div>
        {e?.counterparty && <div className="font-mono text-[10px] text-white/25 truncate max-w-[120px]">→ {e.counterparty.slice(0, 8)}…</div>}
        <div className="font-mono text-[10px] text-white/20 flex-shrink-0 ml-auto">{ev.ts ? new Date(ev.ts).toLocaleString() : "—"}</div>
      </div>
    );
  };

  const renderStandardEvent = (ev: EventRow) => {
    const evidence = ev.evidence as any;
    const reasons = evidence?.reasons as string[] | undefined;
    const psi = evidence?.mpi ?? evidence?.psi ?? null;
    return (
      <div key={ev.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 border border-white/[0.04] rounded-lg hover:bg-white/[0.02] transition-colors">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: severityColor(ev.severity) }} />
        <div className="font-mono text-xs tracking-wider min-w-[100px]" style={{ color: severityColor(ev.severity) }}>{ev.type || "—"}</div>
        <div className="font-mono text-xs text-white/50 min-w-[60px]">SN-{ev.netuid}</div>
        {psi != null && <div className="font-mono text-xs text-white/40">PSI {psi}</div>}
        <div className="font-mono text-[10px] text-white/30 flex-1 truncate">{reasons?.join(" · ") || "—"}</div>
        <div className="font-mono text-[10px] text-white/20 flex-shrink-0">{ev.ts ? new Date(ev.ts).toLocaleString() : "—"}</div>
      </div>
    );
  };

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <h1 className="font-mono text-base sm:text-lg tracking-widest text-white/80 mb-4 sm:mb-6">{t("alerts.title")}</h1>
      {(!deduped || deduped.length === 0) ? (
        <div className="text-center text-white/20 font-mono mt-20">{t("alerts.empty")}</div>
      ) : (
        <div className="space-y-2">
          {deduped.map(ev => ev.type === "WHALE_MOVE" ? renderWhaleEvent(ev) : renderStandardEvent(ev))}
        </div>
      )}
    </div>
  );
}
