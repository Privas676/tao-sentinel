import React, { useMemo, useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useLocalPortfolio } from "@/hooks/use-local-portfolio";
import { useSubnetScores, type UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { useSubnetVerdicts } from "@/hooks/use-subnet-verdict";
import { buildSubnetDecision, type SubnetDecision } from "@/lib/subnet-decision";
import { confianceColor } from "@/lib/data-fusion";
import SwipeHint from "@/components/SwipeHint";

import { toast } from "sonner";
import { SectionCard, SectionTitle, KPIChip, Metric, Sparkline, GOLD, GO, WARN, BREAK, MUTED } from "@/components/sentinel/Atoms";

/* ═══════════════════════════════════════════════════════ */
/*   PORTFOLIO COMMANDER — Strategic Cockpit               */
/* ═══════════════════════════════════════════════════════ */

/* ── Currency ── */
const CURRENCY_KEY = "portfolio_display_currency";
type Currency = "TAO" | "USD";

function useCurrencyToggle() {
  const [currency, setCurrency] = useState<Currency>(() => {
    try { return (localStorage.getItem(CURRENCY_KEY) as Currency) || "TAO"; } catch { return "TAO"; }
  });
  const toggle = (c: Currency) => { setCurrency(c); localStorage.setItem(CURRENCY_KEY, c); };
  return { currency, toggle };
}

/* ── Inline editor ── */
function InlineEditQty({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  const save = () => { const n = parseFloat(draft); if (!isNaN(n) && n > 0) onSave(parseFloat(n.toFixed(4))); setEditing(false); };
  if (!editing) return <span className="cursor-pointer hover:text-foreground transition-colors" onClick={() => { setDraft(String(value)); setEditing(true); }}>{value.toFixed(2)}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <input ref={ref} type="number" value={draft} min={0.01} step={0.01} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(String(value)); setEditing(false); } }}
        className="w-20 bg-muted/30 border border-border rounded px-1.5 py-0.5 font-mono text-sm text-foreground/80 outline-none focus:border-primary/40" />
      <button onClick={save} className="text-primary/80 hover:text-primary text-xs">✓</button>
      <button onClick={() => { setDraft(String(value)); setEditing(false); }} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
    </span>
  );
}

/* ── Subnet Dropdown ── */
function SubnetDropdown({ subnets, value, onChange, isOwned }: { subnets: { netuid: number; name: string }[]; value: number; onChange: (v: number) => void; isOwned: (n: number) => boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  const selected = subnets.find(s => s.netuid === value);
  const filtered = subnets.filter(s => { const q = search.toLowerCase(); return s.name.toLowerCase().includes(q) || `sn-${s.netuid}`.includes(q) || String(s.netuid).includes(q); });
  return (
    <div ref={ref} className="relative mt-1">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between bg-muted/20 border border-border rounded-lg px-3 py-2.5 font-mono text-xs text-foreground/80 hover:border-muted-foreground/30 transition-colors">
        <span>{selected ? `SN-${selected.netuid} — ${selected.name}` : "..."}</span>
        <svg className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg overflow-hidden shadow-2xl bg-popover border border-border">
          <div className="px-2 pt-2 pb-1">
            <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
              className="w-full bg-muted/20 border border-border rounded px-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-muted-foreground" />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-3 font-mono text-[10px] text-muted-foreground text-center">—</div>}
            {filtered.map(s => (
              <button key={s.netuid} type="button" onClick={() => { onChange(s.netuid); setOpen(false); setSearch(""); }}
                className={`w-full text-left px-3 py-2 font-mono text-[11px] flex items-center gap-2 transition-colors ${s.netuid === value ? "bg-muted/40 text-foreground" : "text-foreground/65 hover:bg-muted/20"}`}>
                <span className="text-muted-foreground w-8 shrink-0">SN-{s.netuid}</span>
                <span className="truncate flex-1">{s.name}</span>
                {isOwned(s.netuid) && <span className="text-[8px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/15">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Action helpers — use unified decision source ── */
function portfolioActionColor(a: string): string {
  if (a === "RENFORCER") return GO;
  if (a === "SORTIR") return BREAK;
  if (a === "REDUIRE" || a === "RÉDUIRE") return WARN;
  return MUTED;
}

/* ═══════════════════════════════════════ */
/*   MAIN PAGE                              */
/* ═══════════════════════════════════════ */
export default function PortfolioPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const portfolio = useLocalPortfolio();
  const [showAdd, setShowAdd] = useState(false);
  const [showAlloc, setShowAlloc] = useState(false);
  const [addNetuid, setAddNetuid] = useState<number>(1);
  const [addQty, setAddQty] = useState<number>(10);
  const { currency, toggle: toggleCurrency } = useCurrencyToggle();

  const { scores, sparklines, subnetList, taoUsd } = useSubnetScores();
  const { verdicts } = useSubnetVerdicts();

  // ── Seed portfolio positions (one-time import) ──
  useEffect(() => {
    const SEED_KEY = "portfolio_seed_v1";
    if (localStorage.getItem(SEED_KEY)) return;
    const seed = [
      { sn: 0, tao: 37.504389 },
      { sn: 59, tao: 10.107697 },
      { sn: 95, tao: 10.070618 },
      { sn: 106, tao: 5.049999 },
      { sn: 54, tao: 5.049999 },
      { sn: 103, tao: 5.065044 },
      { sn: 73, tao: 5.061782 },
      { sn: 36, tao: 5.039932 },
      { sn: 120, tao: 5.021266 },
      { sn: 62, tao: 5.049999 },
      { sn: 44, tao: 5.049999 },
      { sn: 101, tao: 2.05 },
      { sn: 13, tao: 2.05 },
      { sn: 50, tao: 2.068322 },
      { sn: 71, tao: 2.04707 },
      { sn: 35, tao: 2.030613 },
    ];
    for (const p of seed) {
      if (portfolio.isOwned(p.sn)) {
        portfolio.updateQuantity(p.sn, p.tao);
      } else {
        portfolio.addPosition(p.sn, p.tao);
      }
    }
    localStorage.setItem(SEED_KEY, Date.now().toString());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtVal = (tao: number) => currency === "USD" ? `$${(tao * (taoUsd || 0)).toFixed(2)}` : `${tao.toFixed(2)} τ`;

  /* ── Build enriched rows ── */
  const rows = useMemo(() => portfolio.positions.map(pos => {
    const netuid = pos.subnet_id;
    const s = scores.get(netuid);
    const v = verdicts.get(netuid);
    const decision = s ? buildSubnetDecision(s, v, fr) : null;
    const alphaPriceTao = s?.consensusPrice ?? 0;
    const alphaQty = alphaPriceTao > 0 ? pos.quantity_tao / alphaPriceTao : 0;
    const pAction = decision?.portfolioActionFr ?? "CONSERVER";
    return {
      netuid, name: s?.name || `SN-${netuid}`,
      taoInvest: pos.quantity_tao, entryPrice: pos.entry_price, alphaPriceTao, alphaQty,
      opp: s?.opp ?? 0, risk: s?.risk ?? 0, stability: s?.stability ?? 50,
      momentumScore: s?.momentumScore ?? 50, momentumLabel: s?.momentumLabel ?? "—",
      confianceScore: s?.confianceScore ?? 50, asymmetry: s?.asymmetry ?? 0,
      action: s?.action ?? "WATCH", pAction,
      isOverridden: s?.isOverridden ?? false,
      depegProbability: s?.depegProbability ?? 0,
      delistCategory: s?.delistCategory ?? "NORMAL",
      healthScores: s?.healthScores ?? { liquidityHealth: 50, activityHealth: 50, emissionPressure: 50, dilutionRisk: 50, concentrationRisk: 50 },
      verdict: v, score: s, decision,
    };
  }), [portfolio.positions, scores, verdicts, fr]);

  /* ── Portfolio analytics ── */
  const analytics = useMemo(() => {
    if (rows.length === 0) return null;
    const totalTao = rows.reduce((a, r) => a + r.taoInvest, 0);
    const weights = rows.map(r => ({ ...r, weight: totalTao > 0 ? (r.taoInvest / totalTao) * 100 : 0 }));
    const avgConviction = rows.reduce((a, r) => {
      const c = r.verdict ? Math.max(r.verdict.entryScore, r.verdict.holdScore) : Math.round(Math.abs(r.opp - r.risk) * (r.confianceScore / 100));
      return a + c;
    }, 0) / rows.length;
    const avgRisk = rows.reduce((a, r) => a + r.risk, 0) / rows.length;
    const maxWeight = Math.max(...weights.map(w => w.weight));
    const reinforceCount = rows.filter(r => r.pAction === "REINFORCE").length;
    const reduceCount = rows.filter(r => r.pAction === "REDUCE").length;
    const exitCount = rows.filter(r => r.pAction === "EXIT").length;
    const holdCount = rows.filter(r => r.pAction === "HOLD").length;
    const fragilePositions = rows.filter(r => r.isOverridden || r.depegProbability >= 30 || r.risk > 70);

    // Alignment score
    let alignment: "aligned" | "partial" | "misaligned" = "aligned";
    if (exitCount >= 2 || fragilePositions.length > rows.length * 0.3) alignment = "misaligned";
    else if (reduceCount > 0 || exitCount > 0) alignment = "partial";

    // Missed opportunities
    const ownedSet = new Set(rows.map(r => r.netuid));
    const missed = Array.from(scores.entries())
      .filter(([nid, sc]) => !ownedSet.has(nid) && sc.opp > 60 && sc.risk < 45 && sc.momentumScore > 50)
      .sort((a, b) => b[1].opp - a[1].opp)
      .slice(0, 3)
      .map(([nid, sc]) => ({ netuid: nid, name: sc.name, opp: sc.opp }));

    return {
      totalTao, weights, avgConviction, avgRisk, maxWeight,
      reinforceCount, reduceCount, exitCount, holdCount,
      fragilePositions, alignment, missed,
    };
  }, [rows, scores]);

  /* ── Action categories for executive summary ── */
  const actionCategories = useMemo(() => {
    if (!analytics) return null;
    const exitRows = rows.filter(r => r.pAction === "EXIT").sort((a, b) => b.risk - a.risk);
    const reduceRows = rows.filter(r => r.pAction === "REDUCE").sort((a, b) => b.risk - a.risk);
    const reinforceRows = rows.filter(r => r.pAction === "REINFORCE").sort((a, b) => b.opp - a.opp);
    const holdRows = rows.filter(r => r.pAction === "HOLD");
    return [
      { key: "exit", label: fr ? "À VENDRE" : "SELL NOW", icon: "🔴", color: BREAK, rows: exitRows, priority: exitRows.length > 0 },
      { key: "reduce", label: fr ? "À SURVEILLER" : "MONITOR", icon: "⚠", color: WARN, rows: reduceRows, priority: reduceRows.length > 0 },
      { key: "reinforce", label: fr ? "À RENFORCER" : "REINFORCE", icon: "⬆", color: GO, rows: reinforceRows, priority: false },
      { key: "hold", label: fr ? "À CONSERVER" : "HOLD", icon: "✓", color: MUTED, rows: holdRows, priority: false },
    ];
  }, [analytics, rows, fr]);

  /* ── Handlers ── */
  const addPrice = scores.get(addNetuid)?.consensusPrice ?? 0;
  const handleAdd = () => {
    if (addQty <= 0) return;
    portfolio.addPosition(addNetuid, addQty, scores.get(addNetuid)?.consensusPrice);
    toast.success(fr ? `SN-${addNetuid} ajouté ✓` : `SN-${addNetuid} added ✓`);
    setShowAdd(false); setAddQty(10);
  };
  const handleSell = (netuid: number) => {
    portfolio.sellPosition(netuid, scores.get(netuid)?.consensusPrice);
    toast.success(fr ? `SN-${netuid} vendu ✓` : `SN-${netuid} sold ✓`);
  };

  /* ═══════════════════════════════════════ */
  /*   RENDER                                */
  /* ═══════════════════════════════════════ */
  return (
    <div className="h-full w-full bg-background text-foreground overflow-auto pb-8">
      <div className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-7">

        {/* ══════════════════════════════════ */}
        {/*   1. HEADER                         */}
        {/* ══════════════════════════════════ */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-mono text-lg sm:text-xl tracking-wider text-gold">Portfolio Commander</h1>
            <p className="font-mono text-[10px] text-muted-foreground mt-1 max-w-md leading-relaxed">
              {fr ? "Pilote l'exposition, la concentration et les décisions de renfort ou de réduction." : "Control exposure, concentration, and reinforce/reduce decisions."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg overflow-hidden border border-border">
              {(["TAO", "USD"] as Currency[]).map(c => (
                <button key={c} onClick={() => toggleCurrency(c)}
                  className={`font-mono text-[10px] tracking-wider px-3 py-1.5 transition-all ${currency === c ? "bg-muted/40 text-gold" : "text-muted-foreground hover:text-foreground"}`}>
                  {c === "TAO" ? "τ" : "$"}
                </button>
              ))}
            </div>
            {taoUsd && <span className="font-mono text-[9px] text-muted-foreground">TAO ${taoUsd.toFixed(2)}</span>}
          </div>
        </div>

        {/* ══════════════════════════════════ */}
        {/*   2. HERO KPIs                      */}
        {/* ══════════════════════════════════ */}
        {analytics && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            <KPIChip label={fr ? "VALEUR" : "VALUE"} value={fmtVal(analytics.totalTao)} color={GOLD} sub={`${rows.length} pos.`} />
            <KPIChip label="CONVICTION" value={Math.round(analytics.avgConviction)} color={analytics.avgConviction > 20 ? GO : analytics.avgConviction > 0 ? WARN : BREAK} />
            <KPIChip label={fr ? "RISQUE" : "RISK"} value={Math.round(analytics.avgRisk)} color={analytics.avgRisk > 60 ? BREAK : analytics.avgRisk > 40 ? WARN : GO} />
            <KPIChip label="CONCENTRATION" value={`${analytics.maxWeight.toFixed(0)}%`} color={analytics.maxWeight > 40 ? WARN : MUTED} sub={fr ? "top pos." : "top pos."} />
            <KPIChip label={fr ? "À AGIR" : "ACTIONABLE"} value={analytics.reinforceCount + analytics.reduceCount + analytics.exitCount} color={analytics.exitCount > 0 ? BREAK : analytics.reduceCount > 0 ? WARN : GO} sub={fr ? "décisions" : "decisions"} />
          </div>
        )}

        {/* ══════════════════════════════════ */}
        {/*   2B. EXECUTIVE ACTION SUMMARY      */}
        {/* ══════════════════════════════════ */}
        {actionCategories && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {actionCategories.map(cat => (
              <div key={cat.key} className="rounded-xl overflow-hidden" style={{
                border: `1px solid color-mix(in srgb, ${cat.color} ${cat.priority ? "20%" : "10%"}, transparent)`,
                background: `color-mix(in srgb, ${cat.color} ${cat.priority ? "5%" : "2%"}, transparent)`,
              }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid color-mix(in srgb, ${cat.color} 8%, transparent)` }}>
                  <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: cat.color }}>
                    {cat.icon} {cat.label}
                  </span>
                  <span className="font-mono text-[11px] font-bold" style={{ color: cat.color }}>{cat.rows.length}</span>
                </div>
                <div className="px-3 py-2 space-y-1">
                  {cat.rows.length === 0 ? (
                    <div className="font-mono text-[9px] text-muted-foreground py-1">—</div>
                  ) : cat.rows.slice(0, 3).map(r => (
                    <Link key={r.netuid} to={`/subnets/${r.netuid}`} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                      <span className="font-mono text-[9px] text-muted-foreground">SN-{r.netuid}</span>
                      <span className="font-mono text-[9px] text-foreground/70 truncate flex-1">{r.name}</span>
                      {cat.key === "exit" && <span className="font-mono text-[8px] font-bold" style={{ color: BREAK }}>R{r.risk}</span>}
                      {cat.key === "reinforce" && <span className="font-mono text-[8px] font-bold" style={{ color: GO }}>O{r.opp}</span>}
                    </Link>
                  ))}
                  {cat.rows.length > 3 && (
                    <div className="font-mono text-[8px] text-muted-foreground">+{cat.rows.length - 3} {fr ? "autres" : "more"}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════ */}
        {/*   3. DIAGNOSTIC + ALERTS (merged)   */}
        {/* ══════════════════════════════════ */}
        {analytics && (
          <SectionCard>
            <SectionTitle icon="🩺" title={fr ? "Diagnostic & Alertes" : "Diagnostic & Alerts"} badge={
              <span className="font-mono text-[10px] font-bold px-2.5 py-1 rounded-md" style={{
                color: analytics.alignment === "aligned" ? GO : analytics.alignment === "partial" ? WARN : BREAK,
                background: `color-mix(in srgb, ${analytics.alignment === "aligned" ? GO : analytics.alignment === "partial" ? WARN : BREAK} 8%, transparent)`,
              }}>
                {analytics.alignment === "aligned" ? (fr ? "✓ Aligné" : "✓ Aligned")
                  : analytics.alignment === "partial" ? (fr ? "~ Partiel" : "~ Partial")
                  : (fr ? "✕ Désaligné" : "✕ Misaligned")}
              </span>
            } />
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                {analytics.exitCount > 0 && (
                  <Metric label={fr ? `Sortie${analytics.exitCount > 1 ? "s" : ""} recommandée${analytics.exitCount > 1 ? "s" : ""}` : `Exit${analytics.exitCount > 1 ? "s" : ""} recommended`}
                    value={rows.filter(r => r.pAction === "EXIT").map(r => `SN-${r.netuid}`).join(", ")} color={BREAK} />
                )}
                {analytics.reduceCount > 0 && (
                  <Metric label={fr ? `Réduction${analytics.reduceCount > 1 ? "s" : ""}` : `Reduction${analytics.reduceCount > 1 ? "s" : ""}`}
                    value={rows.filter(r => r.pAction === "REDUCE").map(r => `SN-${r.netuid}`).join(", ")} color={WARN} />
                )}
                {analytics.fragilePositions.length > 0 && analytics.fragilePositions.some(p => p.pAction !== "EXIT" && p.pAction !== "REDUCE") && (
                  <Metric label={fr ? "Positions fragiles" : "Fragile positions"}
                    value={analytics.fragilePositions.filter(p => p.pAction !== "EXIT" && p.pAction !== "REDUCE").map(p => `SN-${p.netuid}`).join(", ")} color={BREAK} />
                )}
                {analytics.maxWeight > 35 && (
                  <Metric label={fr ? "Surexposition" : "Overexposure"} value={`Top: ${analytics.maxWeight.toFixed(0)}%`} color={WARN} />
                )}
                {analytics.reinforceCount > 0 && (
                  <Metric label={fr ? "Renforts cohérents" : "Coherent reinforcements"}
                    value={rows.filter(r => r.pAction === "REINFORCE").map(r => `SN-${r.netuid}`).join(", ")} color={GO} />
                )}
                {analytics.missed.length > 0 && (
                  <Metric label={fr ? "Opportunités manquées" : "Missed opportunities"} value={analytics.missed.map(m => `SN-${m.netuid}`).join(", ")} color={GOLD} />
                )}
              </div>
              {analytics.alignment === "aligned" && analytics.exitCount === 0 && analytics.reduceCount === 0 && analytics.fragilePositions.length === 0 && (
                <p className="font-mono text-[10px] text-muted-foreground italic">{fr ? "Aucune alerte — portefeuille cohérent." : "No alerts — portfolio is coherent."}</p>
              )}
            </div>
          </SectionCard>
        )}

        {/* ══════════════════════════════════ */}
        {/*   4. ALLOCATION TARGET              */}
        {/* ══════════════════════════════════ */}
        {analytics && analytics.weights.length > 0 && (
          <SectionCard>
            <SectionTitle icon="⚖️" title={fr ? "Allocation & Cible" : "Allocation & Target"} badge={
              <button onClick={() => setShowAlloc(!showAlloc)} className="font-mono text-[8px] text-muted-foreground hover:text-foreground transition-colors">
                {showAlloc ? "▲" : "▼"} {analytics.weights.length} pos.
              </button>
            } />
            {showAlloc && (
              <div className="px-5 py-4">
                <div className="space-y-2">
                  {analytics.weights.sort((a, b) => b.weight - a.weight).map(w => {
                    const targetWeight = w.pAction === "EXIT" ? 0
                      : w.pAction === "REDUCE" ? Math.max(0, w.weight * 0.5)
                      : w.pAction === "REINFORCE" ? Math.min(15, w.weight * 1.5)
                      : w.weight;
                    const delta = targetWeight - w.weight;
                    return (
                      <div key={w.netuid} className="flex items-center gap-3">
                        <Link to={`/subnets/${w.netuid}`} className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors w-[110px] shrink-0 truncate">
                          SN-{w.netuid} {w.name}
                        </Link>
                        <div className="flex-1 flex items-center gap-1.5">
                          <div className="flex-1 h-[5px] rounded-full overflow-hidden bg-muted/20 relative">
                            <div className="h-full rounded-full bg-muted-foreground/25" style={{ width: `${Math.min(100, w.weight)}%` }} />
                          </div>
                          <span className="font-mono text-[9px] text-muted-foreground w-10 text-right">{w.weight.toFixed(1)}%</span>
                        </div>
                        <span className="font-mono text-[9px] w-6 text-center" style={{ color: delta > 2 ? GO : delta < -2 ? BREAK : MUTED }}>
                          {delta > 0 ? "↑" : delta < -1 ? "↓" : "="}
                        </span>
                        <span className="font-mono text-[9px] w-10 text-right" style={{ color: portfolioActionColor(w.pAction) }}>
                          {targetWeight.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ══════════════════════════════════ */}
        {/*   5. POSITIONS TABLE                */}
        {/* ══════════════════════════════════ */}
        <SwipeHint storageKey="swipe-portfolio-v1" />
        <SectionCard>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <span className="text-sm opacity-70">📋</span>
              <h2 className="font-mono text-[10px] tracking-[0.15em] uppercase text-gold">Positions</h2>
              <span className="font-mono text-[9px] text-muted-foreground">{rows.length}</span>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="font-mono text-[9px] tracking-wider px-3 py-1.5 rounded-lg border border-primary/20 text-primary/80 hover:text-primary hover:border-primary/40 transition-all">
              + {fr ? "Ajouter" : "Add"}
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <span className="text-3xl opacity-70">📊</span>
              <p className="font-mono text-[11px] text-muted-foreground">{fr ? "Aucune position" : "No positions"}</p>
              <button onClick={() => setShowAdd(true)} className="font-mono text-[10px] text-primary/60 hover:text-primary transition-colors">
                + {fr ? "Ajouter un subnet" : "Add a subnet"}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="w-full text-left font-mono" style={{ minWidth: 820 }}>
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="py-2.5 px-3 text-[8px] tracking-[0.15em] uppercase text-muted-foreground font-normal whitespace-nowrap sticky left-0 z-10 bg-background">Subnet</th>
                    {[
                      fr ? "Position" : "Position", fr ? "Poids" : "Weight",
                      "Conv.", "Risk", "Action", fr ? "Raison" : "Signal", "Mom.", ""
                    ].map((h, i) => (
                      <th key={i} className="py-2.5 px-3 text-[8px] tracking-[0.15em] uppercase text-muted-foreground font-normal whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.sort((a, b) => {
                    const order = { EXIT: 0, REDUCE: 1, REINFORCE: 2, HOLD: 3 };
                    return (order[a.pAction] ?? 3) - (order[b.pAction] ?? 3);
                  }).map(r => {
                    const weight = analytics ? (analytics.totalTao > 0 ? (r.taoInvest / analytics.totalTao) * 100 : 0) : 0;
                    const conv = r.verdict ? Math.max(r.verdict.entryScore, r.verdict.holdScore) : Math.round(Math.abs(r.opp - r.risk) * (r.confianceScore / 100));
                    const aColor = portfolioActionColor(r.pAction);
                    const rowBorder = r.pAction === "EXIT" ? "border-l-2 border-l-destructive/40" : r.pAction === "REDUCE" ? "border-l-2 border-l-signal-hold/40" : "";

                    const signalReason = (() => {
                      if (r.isOverridden) return fr ? "Override actif" : "Active override";
                      if (r.depegProbability >= 40) return `Depeg ${r.depegProbability}%`;
                      if (r.pAction === "EXIT") return fr ? "Signal de sortie" : "Exit signal";
                      if (r.pAction === "REDUCE") return fr ? `Risque ${r.risk}` : `Risk ${r.risk}`;
                      if (r.pAction === "REINFORCE" && r.opp > 55) return fr ? `Opp. forte (${r.opp})` : `Strong opp. (${r.opp})`;
                      if (r.pAction === "REINFORCE") return fr ? "Momentum +" : "Momentum +";
                      if (r.stability > 60) return fr ? "Position stable" : "Stable position";
                      return fr ? "En observation" : "Monitoring";
                    })();

                    return (
                      <tr key={r.netuid} className={`border-b border-border hover:bg-muted/10 transition-colors ${rowBorder}`}>
                        <td className="py-3 px-3 sticky left-0 z-[5] bg-background" style={{ boxShadow: "4px 0 6px -2px hsla(0,0%,0%,0.3)" }}>
                          <Link to={`/subnets/${r.netuid}`} className="hover:text-foreground transition-colors">
                           <span className="text-[11px] text-muted-foreground">SN-{r.netuid}</span>
                            <span className="text-[11px] text-foreground/80 ml-1.5 hidden sm:inline">{r.name}</span>
                          </Link>
                          {r.isOverridden && <span className="sm:hidden ml-1.5 text-[7px] px-1 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">OVR</span>}
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-foreground/70">
                          <InlineEditQty value={r.taoInvest} onSave={v => { portfolio.updateQuantity(r.netuid, v); toast.success("✓"); }} />
                          <span className="text-muted-foreground ml-1">τ</span>
                        </td>
                        <td className="py-3 px-3 font-mono text-[10px] text-muted-foreground">{weight.toFixed(1)}%</td>
                        <td className="py-3 px-3 font-mono text-[11px] font-bold" style={{ color: conv > 20 ? GO : conv > 0 ? WARN : BREAK }}>{conv}</td>
                        <td className="py-3 px-3 font-mono text-[11px] font-bold" style={{ color: r.risk > 60 ? BREAK : r.risk > 40 ? WARN : GO }}>{r.risk}</td>
                        <td className="py-3 px-3">
                          <span className="font-mono text-[9px] font-bold tracking-wider px-2 py-1 rounded" style={{
                            color: aColor,
                            background: `color-mix(in srgb, ${aColor} 8%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${aColor} 15%, transparent)`,
                          }}>
                            {r.pAction}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-[9px] text-muted-foreground" style={{ maxWidth: 130 }}>
                          {signalReason}
                        </td>
                        <td className="py-3 px-3">
                          <Sparkline data={sparklines?.get(r.netuid) || []} />
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex gap-1">
                            <button onClick={() => handleSell(r.netuid)} className="font-mono text-[8px] px-2 py-1 rounded border border-destructive/15 text-destructive/60 hover:text-destructive transition-colors">
                              {fr ? "Vendre" : "Sell"}
                            </button>
                            <button onClick={() => portfolio.removePosition(r.netuid)} className="font-mono text-[8px] px-1.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors">✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ── Archive ── */}
        {portfolio.archive.length > 0 && (
          <SectionCard>
            <SectionTitle icon="📜" title={fr ? "Historique" : "History"} />
            <div className="px-5 py-3 space-y-1">
              {portfolio.archive.slice(-8).reverse().map((a, i) => (
                <div key={i} className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground py-1 border-b border-border last:border-0">
                  <span>SN-{a.subnet_id}</span>
                  <span>{a.quantity_tao.toFixed(2)} τ</span>
                  {a.pnl_estimated !== undefined && (
                    <span style={{ color: a.pnl_estimated >= 0 ? GO : BREAK }}>
                      P&L: {a.pnl_estimated >= 0 ? "+" : ""}{a.pnl_estimated.toFixed(4)} τ
                    </span>
                  )}
                  <span className="text-muted-foreground ml-auto">{new Date(a.closed_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      {/* ── Add Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4 bg-popover border border-border" onClick={e => e.stopPropagation()}>
            <h2 className="font-mono text-sm tracking-widest text-foreground/80">{fr ? "AJOUTER AU PORTEFEUILLE" : "ADD TO PORTFOLIO"}</h2>
            <div>
              <label className="font-mono text-[9px] text-muted-foreground tracking-wider">SUBNET</label>
              <SubnetDropdown subnets={subnetList || []} value={addNetuid} onChange={setAddNetuid} isOwned={portfolio.isOwned} />
            </div>
            <div>
              <label className="font-mono text-[9px] text-muted-foreground tracking-wider">{fr ? "QUANTITÉ TAO" : "QUANTITY TAO"}</label>
              <input type="number" value={addQty} onChange={e => setAddQty(Number(e.target.value))} min={0.01} step={1}
                className="w-full mt-1 bg-muted/20 border border-border rounded-lg px-3 py-2 font-mono text-xs text-foreground/80" />
            </div>
            <div className="rounded-lg p-3 space-y-1 bg-muted/10 border border-border">
              <div className="flex justify-between font-mono text-[10px]">
                 <span className="text-muted-foreground">{fr ? "Prix consensus" : "Consensus price"}</span>
                 <span className="text-muted-foreground">{addPrice.toFixed(6)} τ</span>
              </div>
              {portfolio.isOwned(addNetuid) && (
                <div className="font-mono text-[10px] text-signal-hold">{fr ? "⚠ Déjà possédé — quantité ajoutée" : "⚠ Already owned — qty added"}</div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 font-mono text-[11px] py-2.5 rounded-lg border border-border text-muted-foreground">{fr ? "ANNULER" : "CANCEL"}</button>
              <button onClick={handleAdd} disabled={addQty <= 0}
                className="flex-1 font-mono text-[11px] py-2.5 rounded-lg border border-primary/30 text-primary/90 hover:bg-primary/10 transition-all disabled:opacity-30">
                {fr ? "AJOUTER" : "ADD"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
