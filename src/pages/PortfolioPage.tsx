import React, { useMemo, useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useSubnetScores, type UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { stabilityColor } from "@/lib/gauge-engine";
import { systemStatusLabel, systemStatusColor } from "@/lib/risk-override";
import type { SmartCapitalState } from "@/lib/gauge-engine";
import { toast } from "sonner";

/* ═══════════════════════════════════════ */
/*        SPARKLINE COMPONENT              */
/* ═══════════════════════════════════════ */
const Sparkline = React.forwardRef<HTMLDivElement, { data: number[]; width?: number; height?: number }>(function Sparkline({ data, width = 64, height = 20 }, ref) {
  if (data.length < 2) return <span className="text-white/10 text-[9px]">—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const first = data[0], last = data[data.length - 1];
  const trend = last - first;
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;
  const color = trend > 0 ? "rgba(76,175,80,0.7)" : trend < 0 ? "rgba(229,57,53,0.7)" : "rgba(255,255,255,0.3)";
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 1 - ((v - min) / range) * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="relative group inline-block">
      <svg width={width} height={height} className="inline-block">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
        style={{ width: 130 }}>
        <div className="rounded-lg px-3 py-2 font-mono text-[10px] space-y-1"
          style={{ background: "rgba(10,10,14,0.95)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex justify-between"><span className="text-white/35">Min</span><span className="text-white/70">{min.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-white/35">Max</span><span className="text-white/70">{max.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-white/35">7j</span><span style={{ color }} className="font-bold">{pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%</span></div>
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════ */
/*        SUBNET DROPDOWN (dark theme)     */
/* ═══════════════════════════════════════ */
function SubnetDropdown({ subnets, value, onChange, isOwned }: {
  subnets: { netuid: number; name: string }[];
  value: number;
  onChange: (v: number) => void;
  isOwned: (n: number) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const selected = subnets.find(s => s.netuid === value);
  const filtered = subnets.filter(s => {
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || `sn-${s.netuid}`.includes(q) || String(s.netuid).includes(q);
  });

  return (
    <div ref={ref} className="relative mt-1">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-xs text-white/80 hover:border-white/20 transition-colors">
        <span>{selected ? `SN-${selected.netuid} — ${selected.name}` : "..."}</span>
        <svg className={`w-3.5 h-3.5 text-white/30 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg overflow-hidden shadow-2xl"
          style={{ background: "rgba(14,14,18,0.98)", border: "1px solid rgba(255,215,0,0.12)" }}>
          <div className="px-2 pt-2 pb-1">
            <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 font-mono text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-white/25" />
          </div>
          <div className="max-h-52 overflow-y-auto scrollbar-thin">
            {filtered.length === 0 && (
              <div className="px-3 py-3 font-mono text-[10px] text-white/20 text-center">Aucun résultat</div>
            )}
            {filtered.map(s => {
              const owned = isOwned(s.netuid);
              const active = s.netuid === value;
              return (
                <button key={s.netuid} type="button"
                  onClick={() => { onChange(s.netuid); setOpen(false); setSearch(""); }}
                  className={`w-full text-left px-3 py-2 font-mono text-[11px] flex items-center gap-2 transition-colors ${
                    active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white/90"
                  }`}>
                  <span className="text-white/30 w-8 shrink-0">SN-{s.netuid}</span>
                  <span className="truncate flex-1">{s.name}</span>
                  {owned && <span className="text-[8px] px-1.5 py-0.5 rounded shrink-0" style={{
                    background: "rgba(255,215,0,0.1)", color: "rgba(255,215,0,0.6)", border: "1px solid rgba(255,215,0,0.15)",
                  }}>possédé</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function scColor(state: SmartCapitalState): string {
  switch (state) {
    case "ACCUMULATION": return "rgba(76,175,80,0.8)";
    case "DISTRIBUTION": return "rgba(229,57,53,0.8)";
    case "STABLE": return "rgba(255,248,220,0.4)";
  }
}

/* ═══════════════════════════════════════ */
/*        MAIN PAGE                        */
/* ═══════════════════════════════════════ */
export default function PortfolioPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const portfolio = useLocalPortfolio();
  const [showAdd, setShowAdd] = useState(false);
  const [addNetuid, setAddNetuid] = useState<number>(1);
  const [addQty, setAddQty] = useState<number>(10);

  // ── UNIFIED SCORES (single source of truth) ──
  const { scores, scoreTimestamp, sparklines, subnetList, dataAlignment, dataAgeDebug } = useSubnetScores();

  // Build enriched rows for portfolio positions using UNIFIED scores
  const rows = useMemo(() => {
    return portfolio.positions.map(pos => {
      const netuid = pos.subnet_id;
      const s = scores.get(netuid);

      // Use unified scores directly — NO recalculation
      const opp = s?.opp ?? 0;
      const risk = s?.risk ?? 0;
      const asymmetry = s?.asymmetry ?? 0;
      const stability = s?.stability ?? 50;
      const sc = s?.sc ?? "STABLE" as SmartCapitalState;
      const isOverridden = s?.isOverridden ?? false;
      const systemStatus = s?.systemStatus ?? "OK" as const;
      const confianceData = s?.confianceScore ?? 50;
      const dataUncertain = false; // TMC decoupled
      const isBreak = s?.state === "BREAK" || s?.state === "EXIT_FAST";
      const price = s?.consensusPrice ?? 0;

      // Action: RENFORCER instead of ENTRER for owned subnets
      const baseAction = s?.action ?? "WATCH";
      const action: string = baseAction === "ENTER" ? "REINFORCE" : baseAction;

      const currentValue = pos.quantity_tao * price;

      // Alert conditions
      const alerts: string[] = [];
      if (isOverridden) alerts.push("Risque critique");
      else if (risk > 70) alerts.push("Risque élevé");
      if (stability < 40) alerts.push("Stabilité faible");
      if (dataUncertain) alerts.push("Data incertaine");
      if (isBreak) alerts.push("Zone Critique");

      return {
        netuid,
        name: s?.name || `SN-${netuid}`,
        quantity: pos.quantity_tao,
        entryPrice: pos.entry_price,
        price,
        currentValue,
        opp, risk, asymmetry,
        stability, sc, action,
        isOverridden, systemStatus,
        confianceData, alerts,
      };
    });
  }, [portfolio.positions, scores]);

  // Portfolio totals (weighted aggregates only)
  const totals = useMemo(() => {
    const totalTao = rows.reduce((a, r) => a + r.quantity, 0);
    const totalValue = rows.reduce((a, r) => a + r.currentValue, 0);
    const weightedAS = rows.length > 0
      ? rows.reduce((a, r) => a + r.asymmetry * r.quantity, 0) / (totalTao || 1)
      : 0;
    const avgStability = rows.length > 0
      ? rows.reduce((a, r) => a + r.stability, 0) / rows.length
      : 0;
    const accPct = rows.length > 0
      ? Math.round((rows.filter(r => r.sc === "ACCUMULATION").length / rows.length) * 100)
      : 0;
    const distPct = rows.length > 0
      ? Math.round((rows.filter(r => r.sc === "DISTRIBUTION").length / rows.length) * 100)
      : 0;
    const highRiskPct = rows.length > 0
      ? Math.round((rows.filter(r => r.risk > 60).length / rows.length) * 100)
      : 0;

    return { totalTao, totalValue, weightedAS, avgStability, accPct, distPct, highRiskPct };
  }, [rows]);

  // Portfolio alerts (sorted by severity)
  const portfolioAlerts = useMemo(() => {
    return rows
      .filter(r => r.alerts.length > 0)
      .sort((a, b) => (b.isOverridden ? 1 : 0) - (a.isOverridden ? 1 : 0) || b.risk - a.risk);
  }, [rows]);

  const handleAdd = () => {
    if (addQty <= 0) return;
    const price = scores.get(addNetuid)?.consensusPrice;
    portfolio.addPosition(addNetuid, addQty, price);
    toast.success(fr ? `SN-${addNetuid} ajouté au portefeuille ✓` : `SN-${addNetuid} added to portfolio ✓`);
    setShowAdd(false);
    setAddQty(10);
  };

  const handleSell = (netuid: number) => {
    const price = scores.get(netuid)?.consensusPrice;
    portfolio.sellPosition(netuid, price);
    toast.success(fr ? `SN-${netuid} vendu et archivé ✓` : `SN-${netuid} sold and archived ✓`);
  };

  const addPrice = scores.get(addNetuid)?.consensusPrice ?? 0;

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <h1 className="font-mono text-lg sm:text-xl tracking-widest text-white/85 mb-1 ml-28">
        {fr ? "Portefeuille" : "Portfolio"}
      </h1>
      {/* Score timestamp badge */}
      <div className="mb-5 font-mono text-[8px] text-white/20 flex items-center gap-2" title={`Score snapshot: ${scoreTimestamp}`}>
        📊 Scores unifiés — {new Date(scoreTimestamp).toLocaleTimeString()}
        {dataAlignment !== "ALIGNED" && (
          <span
            className="font-mono text-[8px] px-2 py-0.5 rounded animate-pulse cursor-help"
            style={{
              background: dataAlignment === "STALE" ? "rgba(229,57,53,0.10)" : "rgba(255,193,7,0.08)",
              color: dataAlignment === "STALE" ? "rgba(229,57,53,0.85)" : "rgba(255,193,7,0.75)",
              border: `1px solid ${dataAlignment === "STALE" ? "rgba(229,57,53,0.25)" : "rgba(255,193,7,0.2)"}`,
            }}
            title={`Data ${dataAlignment} — ${dataAgeDebug.map(d => `${d.source}: ${d.ageSeconds}s`).join(", ")}`}
          >
            {dataAlignment === "STALE" ? "⚠ STALE" : "⏳ DEGRADED"}
          </span>
        )}
      </div>

      {/* ── SUMMARY CARDS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SummaryCard label={fr ? "Total TAO" : "Total TAO"} value={`${totals.totalTao.toFixed(2)} τ`} color="rgba(255,215,0,0.7)" />
        <SummaryCard label={fr ? "Valeur estimée" : "Estimated Value"} value={`${totals.totalValue.toFixed(4)} τ`} color="rgba(255,215,0,0.7)" />
        <SummaryCard label={fr ? "AS moyen pondéré" : "Weighted AS"} value={`${totals.weightedAS >= 0 ? "+" : ""}${totals.weightedAS.toFixed(0)}`}
          color={totals.weightedAS >= 0 ? "rgba(76,175,80,0.9)" : "rgba(229,57,53,0.9)"} />
        <SummaryCard label={fr ? "Stabilité moy." : "Avg Stability"} value={`${totals.avgStability.toFixed(0)}%`}
          color={stabilityColor(totals.avgStability)} />
      </div>

      {/* ── MINI DASHBOARD ── */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <MiniStat label={fr ? "Accumulation" : "Accumulation"} value={`${totals.accPct}%`} color="rgba(76,175,80,0.8)" />
        <MiniStat label={fr ? "Distribution" : "Distribution"} value={`${totals.distPct}%`} color="rgba(229,57,53,0.8)" />
        <MiniStat label={fr ? "Risque élevé" : "High Risk"} value={`${totals.highRiskPct}%`} color={totals.highRiskPct > 30 ? "rgba(229,57,53,0.8)" : "rgba(255,255,255,0.4)"} />
      </div>

      {/* ── PORTFOLIO ALERTS ── */}
      {portfolioAlerts.length > 0 && (
        <div className="mb-5 rounded-xl p-3 space-y-2" style={{ background: "rgba(229,57,53,0.04)", border: "1px solid rgba(229,57,53,0.15)" }}>
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-red-400/70">
            {fr ? "⚠ ALERTES PORTEFEUILLE" : "⚠ PORTFOLIO ALERTS"}
          </span>
          {portfolioAlerts.map(r => (
            <div key={r.netuid} className="flex items-center gap-2 font-mono text-[10px]">
              <span className="text-white/50">SN-{r.netuid}</span>
              <span className="text-white/70">{r.name}</span>
              {r.alerts.map((a, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded text-[8px]" style={{
                  background: "rgba(229,57,53,0.15)", color: "rgba(229,57,53,0.9)", border: "1px solid rgba(229,57,53,0.3)",
                }}>{a}</span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── ADD BUTTON ── */}
      <button onClick={() => setShowAdd(true)}
        className="mb-5 font-mono text-[11px] tracking-wider px-5 py-2.5 rounded-lg transition-all hover:scale-105"
        style={{
          background: "linear-gradient(135deg, rgba(76,175,80,0.15), rgba(76,175,80,0.08))",
          color: "rgba(76,175,80,0.9)",
          border: "1px solid rgba(76,175,80,0.3)",
          boxShadow: "0 0 15px rgba(76,175,80,0.08)",
        }}>
        ➕ {fr ? "Ajouter un subnet" : "Add a subnet"}
      </button>

      {/* ── ADD MODAL ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()} style={{
            background: "rgba(10,10,14,0.98)", border: "1px solid rgba(255,215,0,0.15)",
          }}>
            <h2 className="font-mono text-sm tracking-widest text-white/80">{fr ? "AJOUTER AU PORTEFEUILLE" : "ADD TO PORTFOLIO"}</h2>
            <div>
              <label className="font-mono text-[9px] text-white/30 tracking-wider">SUBNET</label>
              <SubnetDropdown
                subnets={subnetList || []}
                value={addNetuid}
                onChange={setAddNetuid}
                isOwned={portfolio.isOwned}
              />
            </div>
            <div>
              <label className="font-mono text-[9px] text-white/30 tracking-wider">{fr ? "QUANTITÉ TAO" : "QUANTITY TAO"}</label>
              <input type="number" value={addQty} onChange={e => setAddQty(Number(e.target.value))} min={0.01} step={1}
                className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white/80" />
            </div>
            {/* Price preview */}
            <div className="rounded-lg p-3 space-y-1" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex justify-between font-mono text-[10px]">
                <span className="text-white/30">{fr ? "Prix consensus" : "Consensus price"}</span>
                <span className="text-white/60">{addPrice.toFixed(6)} τ</span>
              </div>
              <div className="flex justify-between font-mono text-[10px]">
                <span className="text-white/30">{fr ? "Valeur estimée" : "Est. value"}</span>
                <span className="text-white/60">{(addQty * addPrice).toFixed(4)} τ</span>
              </div>
              {portfolio.isOwned(addNetuid) && (
                <div className="flex justify-between font-mono text-[10px]">
                  <span className="text-yellow-500/70">{fr ? "⚠ Déjà possédé — quantité ajoutée" : "⚠ Already owned — quantity added"}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowAdd(false)}
                className="flex-1 font-mono text-[11px] tracking-wider py-2.5 rounded-lg"
                style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {fr ? "ANNULER" : "CANCEL"}
              </button>
              <button onClick={handleAdd} disabled={addQty <= 0}
                className="flex-1 font-mono text-[11px] tracking-wider py-2.5 rounded-lg transition-all hover:scale-[1.02] disabled:opacity-30"
                style={{ background: "rgba(76,175,80,0.15)", color: "rgba(76,175,80,0.9)", border: "1px solid rgba(76,175,80,0.3)" }}>
                {fr ? "AJOUTER" : "ADD"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── POSITIONS TABLE ── */}
      {rows.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <span className="text-3xl">📊</span>
          <p className="font-mono text-xs text-white/35">{fr ? "Aucun subnet dans le portefeuille" : "No subnets in portfolio"}</p>
          <p className="font-mono text-[10px] text-white/20">{fr ? "Ajoutez vos positions pour suivre leur performance" : "Add your positions to track their performance"}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {["SN", fr ? "Nom" : "Name", "TAO", fr ? "Prix" : "Price", fr ? "Valeur" : "Value",
                  fr ? "Prix 7j" : "Price 7d",
                  "Opp", fr ? "Risque" : "Risk", "AS", fr ? "Stabilité" : "Stability",
                  "Smart Capital", fr ? "Statut" : "Status", "Action", ""].map((h, i) => (
                  <th key={i} className="py-2 px-2 font-mono text-[8px] tracking-[0.15em] uppercase text-white/25 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const actionLabel = r.action === "REINFORCE" ? (fr ? "RENFORCER" : "REINFORCE")
                  : r.action === "EXIT" ? (fr ? "SORTIR" : "EXIT")
                  : r.action === "ENTER" ? (fr ? "ENTRER" : "ENTER")
                  : (fr ? "ATTENDRE" : "WATCH");
                const aColor = r.action === "EXIT" ? "rgba(229,57,53,0.9)"
                  : r.action === "REINFORCE" ? "rgba(76,175,80,0.9)"
                  : "rgba(255,193,7,0.8)";
                const aBg = r.action === "EXIT" ? "rgba(229,57,53,0.1)"
                  : r.action === "REINFORCE" ? "rgba(76,175,80,0.08)"
                  : "rgba(255,193,7,0.06)";
                const aBorder = r.action === "EXIT" ? "rgba(229,57,53,0.3)"
                  : r.action === "REINFORCE" ? "rgba(76,175,80,0.25)"
                  : "rgba(255,193,7,0.2)";

                return (
                  <tr key={r.netuid} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                    style={{
                      background: r.isOverridden ? "rgba(229,57,53,0.03)" : undefined,
                      borderLeft: r.isOverridden ? "2px solid rgba(229,57,53,0.4)" : r.alerts.length > 0 ? "2px solid rgba(255,193,7,0.3)" : undefined,
                    }}>
                    <td className="py-3 px-2 text-white/55 text-sm font-mono">{r.netuid}</td>
                    <td className="py-3 px-2 text-sm font-mono">
                      <span className="text-white/80">{r.name}</span>
                      {r.isOverridden && (
                        <span className="ml-2 text-[8px] px-1.5 py-0.5 rounded" style={{
                          background: "rgba(229,57,53,0.15)", color: "rgba(229,57,53,0.9)", border: "1px solid rgba(229,57,53,0.3)",
                        }}>OVERRIDE</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-sm font-mono text-white/70">{r.quantity.toFixed(2)}</td>
                    <td className="py-3 px-2 text-sm font-mono text-white/50">{r.price > 0 ? r.price.toFixed(6) : "—"}</td>
                    <td className="py-3 px-2 text-sm font-mono" style={{ color: "rgba(255,215,0,0.7)" }}>{r.currentValue > 0 ? r.currentValue.toFixed(4) : "—"}</td>
                    <td className="py-3 px-2 text-center"><Sparkline data={sparklines?.get(r.netuid) || []} /></td>
                    <td className="py-3 px-2 text-sm font-mono font-bold" style={{ color: `rgba(76,175,80,${r.opp > 60 ? 0.9 : 0.5})` }}>{r.opp}</td>
                    <td className="py-3 px-2 text-sm font-mono font-bold" style={{ color: r.risk >= 60 ? "rgba(229,57,53,0.9)" : r.risk >= 40 ? "rgba(255,193,7,0.8)" : "rgba(255,255,255,0.4)" }}>{r.risk}</td>
                    <td className="py-3 px-2 text-sm font-mono font-bold" style={{
                      color: r.asymmetry > 20 ? "rgba(76,175,80,0.9)" : r.asymmetry < -20 ? "rgba(229,57,53,0.9)" : "rgba(255,255,255,0.4)",
                    }}>{r.asymmetry > 0 ? "+" : ""}{r.asymmetry}</td>
                    <td className="py-3 px-2 text-sm font-mono" style={{ color: stabilityColor(r.stability) }}>{r.stability}%</td>
                    <td className="py-3 px-2 text-[10px] font-mono" style={{ color: scColor(r.sc) }}>
                      {r.sc === "ACCUMULATION" ? "Accum." : r.sc === "DISTRIBUTION" ? "Distrib." : "Stable"}
                    </td>
                    <td className="py-3 px-2 text-[10px] font-mono" style={{ color: systemStatusColor(r.systemStatus) }}>
                      {systemStatusLabel(r.systemStatus)}
                    </td>
                    <td className="py-3 px-2">
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-lg" style={{
                        background: aBg, color: aColor, border: `1px solid ${aBorder}`,
                      }}>
                        {actionLabel}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex gap-1">
                        <button onClick={() => handleSell(r.netuid)} title={fr ? "Marquer comme vendu" : "Mark as sold"}
                          className="font-mono text-[9px] px-2 py-1 rounded transition-all hover:scale-105"
                          style={{ background: "rgba(229,57,53,0.1)", color: "rgba(229,57,53,0.8)", border: "1px solid rgba(229,57,53,0.2)" }}>
                          {fr ? "VENDRE" : "SELL"}
                        </button>
                        <button onClick={() => portfolio.removePosition(r.netuid)} title={fr ? "Retirer" : "Remove"}
                          className="font-mono text-[9px] px-2 py-1 rounded transition-all hover:scale-105"
                          style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ARCHIVE ── */}
      {portfolio.archive.length > 0 && (
        <div className="mt-8">
          <h2 className="font-mono text-[10px] tracking-[0.2em] uppercase text-white/25 mb-3">{fr ? "HISTORIQUE VENDU" : "SOLD HISTORY"}</h2>
          <div className="space-y-1">
            {portfolio.archive.slice(-10).reverse().map((a, i) => (
              <div key={i} className="flex items-center gap-3 font-mono text-[10px] text-white/30 py-1.5 border-b border-white/[0.03]">
                <span>SN-{a.subnet_id}</span>
                <span>{a.quantity_tao.toFixed(2)} τ</span>
                {a.pnl_estimated !== undefined && (
                  <span style={{ color: a.pnl_estimated >= 0 ? "rgba(76,175,80,0.7)" : "rgba(229,57,53,0.7)" }}>
                    P&L: {a.pnl_estimated >= 0 ? "+" : ""}{a.pnl_estimated.toFixed(4)} τ
                  </span>
                )}
                <span className="text-white/15">{new Date(a.closed_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── UI Components ── */
function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl px-4 py-3 flex flex-col gap-1" style={{
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <span className="font-mono text-[8px] tracking-[0.15em] uppercase text-white/25">{label}</span>
      <span className="font-mono text-base sm:text-lg font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg px-3 py-2 flex flex-col items-center gap-0.5" style={{
      background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)",
    }}>
      <span className="font-mono text-[7px] tracking-[0.15em] uppercase text-white/20">{label}</span>
      <span className="font-mono text-sm font-bold" style={{ color }}>{value}</span>
    </div>
  );
}
