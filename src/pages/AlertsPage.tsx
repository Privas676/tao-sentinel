import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useMemo, useState } from "react";

type EventRow = {
  id: number;
  netuid: number | null;
  type: string | null;
  severity: number | null;
  ts: string | null;
  evidence: any;
};

type FilterType = "ALL" | "STATE" | "WHALE" | "DATA" | "SMART";

/** Map raw event type to display label */
function typeDisplayLabel(type: string | null, lang: string): { label: string; icon: string; color: string } {
  const fr = lang === "fr";
  switch (type) {
    case "BREAK":
    case "EXIT_FAST":
      return { label: fr ? "ZONE CRITIQUE" : "CRITICAL ZONE", icon: "⛔", color: "rgba(229,57,53,0.9)" };
    case "GO":
      return { label: "GO", icon: "🟢", color: "rgba(76,175,80,0.9)" };
    case "GO_SPECULATIVE":
      return { label: fr ? "SPÉCULATIF" : "SPECULATIVE", icon: "🔶", color: "rgba(255,152,0,0.85)" };
    case "EARLY":
      return { label: "EARLY", icon: "🌱", color: "rgba(139,195,74,0.85)" };
    case "HOLD":
      return { label: "HOLD", icon: "⏸", color: "rgba(255,193,7,0.7)" };
    case "WATCH":
      return { label: "WATCH", icon: "👁", color: "rgba(158,158,158,0.7)" };
    case "CREATED":
      return { label: fr ? "NOUVEAU" : "NEW", icon: "✨", color: "rgba(100,181,246,0.8)" };
    case "DEPEG_WARNING":
      return { label: fr ? "DÉPEG ⚠" : "DEPEG ⚠", icon: "⚠", color: "rgba(255,152,0,0.85)" };
    case "DEPEG_CRITICAL":
      return { label: fr ? "DÉPEG CRITIQUE" : "DEPEG CRITICAL", icon: "🔴", color: "rgba(229,57,53,0.9)" };
    case "WHALE_MOVE":
      return { label: "WHALE", icon: "🐋", color: "rgba(255,215,0,0.8)" };
    case "DATA_DIVERGENCE":
      return { label: fr ? "DIVERGENCE DATA" : "DATA DIVERGENCE", icon: "⚠", color: "rgba(255,152,0,0.8)" };
    case "RISK_OVERRIDE":
      return { label: fr ? "⛔ OVERRIDE RISQUE" : "⛔ RISK OVERRIDE", icon: "🛡", color: "rgba(229,57,53,0.9)" };
    case "PRE_HYPE":
      return { label: fr ? "PRÉ-HYPE" : "PRE-HYPE", icon: "🚀", color: "rgba(156,39,176,0.9)" };
    case "SMART_ACCUMULATION":
      return { label: fr ? "SMART ACCUM." : "SMART ACCUM.", icon: "🧠", color: "rgba(0,188,212,0.85)" };
    default:
      return { label: type || "—", icon: "•", color: "rgba(255,255,255,0.4)" };
  }
}

/** Classify event type into filter category */
function eventCategory(type: string | null): FilterType {
  if (type === "WHALE_MOVE") return "WHALE";
  if (type === "DATA_DIVERGENCE") return "DATA";
  if (type === "PRE_HYPE" || type === "SMART_ACCUMULATION") return "SMART";
  if (type === "RISK_OVERRIDE") return "STATE";
  return "STATE";
}

function subnetLinks(netuid: number | null) {
  if (netuid == null) return null;
  return (
    <span className="inline-flex gap-1.5 ml-1">
      <a href={`https://taostats.io/subnets/${netuid}`} target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="font-mono text-[9px] px-1.5 py-0.5 rounded transition-all hover:scale-105"
        style={{ background: "rgba(255,215,0,0.06)", color: "rgba(255,215,0,0.6)", border: "1px solid rgba(255,215,0,0.12)" }}>
        TaoStats
      </a>
      <a href={`https://taomarketcap.com/subnet/${netuid}`} target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="font-mono text-[9px] px-1.5 py-0.5 rounded transition-all hover:scale-105"
        style={{ background: "rgba(100,181,246,0.06)", color: "rgba(100,181,246,0.6)", border: "1px solid rgba(100,181,246,0.12)" }}>
        TMC
      </a>
    </span>
  );
}

export default function AlertsPage() {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<FilterType>("ALL");

  const { data: events } = useQuery({
    queryKey: ["events-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("ts", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data || []) as EventRow[];
    },
    refetchInterval: 60_000,
  });

  // Deduplicate: keep only latest event per (netuid, type) combo
  const deduped = useMemo(() => {
    if (!events) return [];
    const seen = new Map<string, { event: EventRow; count: number }>();
    for (const ev of events) {
      const key = `${ev.netuid ?? "null"}-${ev.type}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { event: ev, count: 1 });
      } else {
        existing.count++;
      }
    }
    return Array.from(seen.values())
      .filter(({ event }) => filter === "ALL" || eventCategory(event.type) === filter);
  }, [events, filter]);

  const fr = lang === "fr";

  const severityColor = (sev: number | null) => {
    if (!sev || sev <= 1) return "rgba(84,110,122,0.7)";
    if (sev === 2) return "rgba(251,192,45,0.7)";
    if (sev === 3) return "rgba(255,109,0,0.8)";
    return "rgba(229,57,53,0.8)";
  };

  const filterOptions: { value: FilterType; label: string }[] = [
    { value: "ALL", label: fr ? "Tous" : "All" },
    { value: "STATE", label: fr ? "États" : "States" },
    { value: "WHALE", label: "🐋 Whales" },
    { value: "DATA", label: fr ? "⚠ Data" : "⚠ Data" },
    { value: "SMART", label: "🧠 Smart" },
  ];

  const renderWhaleEvent = (ev: EventRow, count: number) => {
    const e = ev.evidence as any;
    const dir = e?.direction === "OUT" ? "↗" : "↙";
    const dirLabel = e?.direction === "OUT" ? (fr ? "SORTIE" : "OUT") : (fr ? "ENTRÉE" : "IN");
    const dirColor = e?.direction === "OUT" ? "rgba(229,57,53,0.8)" : "rgba(76,175,80,0.8)";
    const label = e?.label || "Whale";
    const amount = e?.amount_tao ? `${Number(e.amount_tao).toLocaleString()} τ` : "—";
    return (
      <div key={ev.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 border border-white/[0.04] rounded-lg hover:bg-white/[0.02] transition-colors">
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1 sm:mt-0" style={{ background: severityColor(ev.severity) }} />
        <span className="font-mono text-sm" style={{ color: dirColor }}>{dir}</span>
        <div className="font-mono text-xs tracking-wider font-bold" style={{ color: "rgba(255,215,0,0.8)" }}>🐋 {label}</div>
        <div className="font-mono text-xs font-bold" style={{ color: dirColor }}>{dirLabel} {amount}</div>
        {ev.netuid != null && (
          <span className="font-mono text-xs text-white/40">SN-{ev.netuid} {subnetLinks(ev.netuid)}</span>
        )}
        {e?.counterparty && <div className="font-mono text-[10px] text-white/25 truncate max-w-[120px]">→ {e.counterparty.slice(0, 8)}…</div>}
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {count > 1 && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>×{count}</span>}
          <span className="font-mono text-[10px] text-white/20">{ev.ts ? new Date(ev.ts).toLocaleString() : "—"}</span>
        </div>
      </div>
    );
  };

  const renderDivergenceEvent = (ev: EventRow, count: number) => {
    const e = ev.evidence as any;
    const divs = e?.divergences as { field: string; taostats: number; taomarketcap: number; pct_diff: number }[] || [];
    return (
      <div key={ev.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 border border-white/[0.04] rounded-lg hover:bg-white/[0.02] transition-colors">
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1 sm:mt-0" style={{ background: severityColor(ev.severity) }} />
        <div className="font-mono text-xs tracking-wider" style={{ color: "rgba(255,152,0,0.8)" }}>⚠ {fr ? "DIVERGENCE DATA" : "DATA DIVERGENCE"}</div>
        <div className="font-mono text-xs text-white/50">SN-{ev.netuid} {subnetLinks(ev.netuid)}</div>
        <div className="font-mono text-[10px] text-white/40 flex-1 flex flex-wrap gap-2">
          {divs.map((d, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded" style={{ background: "rgba(255,152,0,0.08)", border: "1px solid rgba(255,152,0,0.15)" }}>
              {d.field}: {d.pct_diff}% ({d.taostats} vs {d.taomarketcap})
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {count > 1 && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>×{count}</span>}
          <span className="font-mono text-[10px] text-white/20">{ev.ts ? new Date(ev.ts).toLocaleString() : "—"}</span>
        </div>
      </div>
    );
  };

  const renderSmartEvent = (ev: EventRow, count: number) => {
    const { label, icon, color } = typeDisplayLabel(ev.type, lang);
    const evidence = ev.evidence as any;
    const intensity = evidence?.intensity ?? evidence?.score ?? null;
    return (
      <div key={ev.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 border rounded-lg hover:bg-white/[0.02] transition-colors"
        style={{ borderColor: `${color}20` }}>
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1 sm:mt-0" style={{ background: color }} />
        <div className="font-mono text-xs tracking-wider font-bold" style={{ color }}>
          {icon} {label}
        </div>
        <div className="font-mono text-xs text-white/50">SN-{ev.netuid} {subnetLinks(ev.netuid)}</div>
        {intensity != null && <div className="font-mono text-[10px] font-bold" style={{ color }}>{fr ? "Intensité" : "Intensity"}: {intensity}%</div>}
        <div className="font-mono text-[10px] text-white/30 flex-1 truncate">
          {evidence?.reasons?.join(" · ") || evidence?.detail || "—"}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {count > 1 && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>×{count}</span>}
          <span className="font-mono text-[10px] text-white/20">{ev.ts ? new Date(ev.ts).toLocaleString() : "—"}</span>
        </div>
      </div>
    );
  };

  const renderStandardEvent = (ev: EventRow, count: number) => {
    const { label, icon, color } = typeDisplayLabel(ev.type, lang);
    const evidence = ev.evidence as any;
    const reasons = evidence?.reasons as string[] | undefined;
    const psi = evidence?.mpi ?? evidence?.psi ?? null;
    return (
      <div key={ev.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 border border-white/[0.04] rounded-lg hover:bg-white/[0.02] transition-colors">
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1 sm:mt-0" style={{ background: severityColor(ev.severity) }} />
        <div className="font-mono text-xs tracking-wider font-bold min-w-[110px]" style={{ color }}>
          {icon} {label}
        </div>
        <div className="font-mono text-xs text-white/50 min-w-[60px]">SN-{ev.netuid} {subnetLinks(ev.netuid)}</div>
        {psi != null && <div className="font-mono text-xs text-white/40">PSI {psi}</div>}
        <div className="font-mono text-[10px] text-white/30 flex-1 truncate">{reasons?.join(" · ") || "—"}</div>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {count > 1 && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>×{count}</span>}
          <span className="font-mono text-[10px] text-white/20">{ev.ts ? new Date(ev.ts).toLocaleString() : "—"}</span>
        </div>
      </div>
    );
  };

  const renderRiskOverrideEvent = (ev: EventRow, count: number) => {
    const e = ev.evidence as any;
    const mpi = e?.mpi ?? "—";
    const quality = e?.quality ?? "—";
    const reasons = (e?.reasons as string[]) || [];
    const gating = e?.gatingFail ? (fr ? "Gating échoué" : "Gating failed") : null;
    const zeroMiners = e?.minersNow === 0 ? (fr ? "0 mineur" : "0 miners") : null;
    const tags = [gating, zeroMiners, ...reasons].filter(Boolean);
    return (
      <div key={ev.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 border rounded-lg hover:bg-white/[0.02] transition-colors"
        style={{ borderColor: "rgba(229,57,53,0.15)" }}>
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1 sm:mt-0" style={{ background: "rgba(229,57,53,0.9)" }} />
        <div className="font-mono text-xs tracking-wider font-bold" style={{ color: "rgba(229,57,53,0.9)" }}>
          🛡 {fr ? "OVERRIDE RISQUE" : "RISK OVERRIDE"}
        </div>
        <div className="font-mono text-xs text-white/50">SN-{ev.netuid} {subnetLinks(ev.netuid)}</div>
        <div className="font-mono text-[10px] text-white/40">MPI {mpi} · Q {quality}</div>
        <div className="font-mono text-[10px] text-white/30 flex-1 flex flex-wrap gap-1">
          {tags.map((t, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded" style={{ background: "rgba(229,57,53,0.08)", border: "1px solid rgba(229,57,53,0.15)", color: "rgba(229,57,53,0.7)" }}>
              {t}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {count > 1 && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>×{count}</span>}
          <span className="font-mono text-[10px] text-white/20">{ev.ts ? new Date(ev.ts).toLocaleString() : "—"}</span>
        </div>
      </div>
    );
  };

  const renderEvent = ({ event, count }: { event: EventRow; count: number }) => {
    if (event.type === "WHALE_MOVE") return renderWhaleEvent(event, count);
    if (event.type === "DATA_DIVERGENCE") return renderDivergenceEvent(event, count);
    if (event.type === "PRE_HYPE" || event.type === "SMART_ACCUMULATION") return renderSmartEvent(event, count);
    if (event.type === "RISK_OVERRIDE") return renderRiskOverrideEvent(event, count);
    return renderStandardEvent(event, count);
  };

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <h1 className="font-mono text-base sm:text-lg tracking-widest text-white/80 mb-4 sm:mb-6">{t("alerts.title")}</h1>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5">
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {filterOptions.map(opt => (
            <button key={opt.value}
              onClick={() => setFilter(opt.value)}
              className="font-mono text-[11px] tracking-wider px-3 py-2 transition-all"
              style={{
                background: filter === opt.value ? "rgba(255,215,0,0.1)" : "transparent",
                color: filter === opt.value ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.35)",
                fontWeight: filter === opt.value ? 700 : 400,
              }}>
              {opt.label}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] text-white/20 ml-2">{deduped.length} {fr ? "signaux" : "signals"}</span>
      </div>

      {(!deduped || deduped.length === 0) ? (
        <div className="text-center text-white/20 font-mono mt-20">{t("alerts.empty")}</div>
      ) : (
        <div className="space-y-2">
          {deduped.map(item => renderEvent(item))}
        </div>
      )}
    </div>
  );
}
