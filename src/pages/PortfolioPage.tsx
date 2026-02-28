import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { usePositions, useOpenPosition, useClosePosition, type DbPosition } from "@/hooks/use-positions";
import { opportunityColor, riskColor, clamp } from "@/lib/gauge-engine";
import { toast } from "sonner";

/* ═══════════════════════════════════════ */
/*        TYPES                            */
/* ═══════════════════════════════════════ */
type LivePrice = { netuid: number; price: number; name: string | null };
type SignalRow = { netuid: number | null; state: string | null; mpi: number | null; score: number | null; confidence_pct: number | null; quality_score: number | null };

/* ═══════════════════════════════════════ */
/*        POSITION CARD                    */
/* ═══════════════════════════════════════ */
function PositionCard({
  pos, livePrice, signal, lang, onClose,
}: {
  pos: DbPosition;
  livePrice: number | null;
  signal: SignalRow | null;
  lang: string;
  onClose: (id: string, price: number) => void;
}) {
  const fr = lang === "fr";
  const currentValue = livePrice ? pos.quantity * livePrice : null;
  const pnl = currentValue ? currentValue - pos.capital : null;
  const pnlPct = pnl !== null && pos.capital > 0 ? (pnl / pos.capital) * 100 : null;
  const stopDist = pnlPct !== null ? pnlPct - pos.stop_loss_pct : null;

  // Smart Capital state per subnet
  const psi = signal?.mpi ?? signal?.score ?? 0;
  const quality = signal?.quality_score ?? 0;
  const conf = signal?.confidence_pct ?? 0;
  const riskScore = deriveRiskSimple(psi, conf, quality, signal?.state ?? null);
  const scState = deriveSCSimple(psi, quality, conf, signal?.state ?? null);

  // Alert conditions
  const alertRef = useRef({ sl: false, tp: false });
  useEffect(() => {
    if (pnlPct === null) return;
    if (pnlPct <= pos.stop_loss_pct && !alertRef.current.sl) {
      alertRef.current.sl = true;
      toast.error(fr ? "⛔ STOP-LOSS ATTEINT" : "⛔ STOP-LOSS HIT", {
        description: `SN-${pos.netuid} : ${pnlPct.toFixed(1)}%`,
      });
    }
    if (pnlPct >= pos.take_profit_pct && !alertRef.current.tp) {
      alertRef.current.tp = true;
      toast.success(fr ? "🎯 TAKE-PROFIT ATTEINT" : "🎯 TAKE-PROFIT HIT", {
        description: `SN-${pos.netuid} : +${pnlPct.toFixed(1)}%`,
      });
    }
  }, [pnlPct, pos.stop_loss_pct, pos.take_profit_pct, pos.netuid, fr]);

  // Exit recommendation
  const exitWarning = scState === "DISTRIBUTION" || riskScore > 70;

  const pnlColor = pnlPct === null ? "rgba(255,255,255,0.4)"
    : pnlPct > 0 ? "rgba(76,175,80,0.9)"
    : pnlPct < -5 ? "rgba(229,57,53,0.9)"
    : "rgba(255,193,7,0.8)";

  return (
    <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{
      background: "rgba(255,255,255,0.02)",
      border: exitWarning ? "1px solid rgba(229,57,53,0.4)" : "1px solid rgba(255,255,255,0.06)",
      boxShadow: exitWarning ? "0 0 20px rgba(229,57,53,0.1)" : undefined,
    }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-white/50 text-xs">SN-{pos.netuid}</span>
          <span className="font-mono text-sm text-white/80 font-bold">{signal ? `SN-${pos.netuid}` : `Subnet ${pos.netuid}`}</span>
          {exitWarning && (
            <span className="font-mono text-[9px] px-2 py-0.5 rounded" style={{
              background: "rgba(229,57,53,0.15)", color: "rgba(229,57,53,0.9)", border: "1px solid rgba(229,57,53,0.3)",
            }}>
              {fr ? "SORTIE RECOMMANDÉE" : "EXIT RECOMMENDED"}
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] tracking-wider" style={{
          color: scState === "ACCUMULATION" ? "rgba(76,175,80,0.8)"
            : scState === "DISTRIBUTION" ? "rgba(229,57,53,0.8)"
            : "rgba(255,255,255,0.35)",
        }}>
          SC: {scState === "ACCUMULATION" ? "Accum." : scState === "DISTRIBUTION" ? "Distrib." : "Stable"}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricBox label={fr ? "Capital" : "Capital"} value={`${pos.capital.toFixed(2)} τ`} color="rgba(255,215,0,0.7)" />
        <MetricBox label={fr ? "Valeur actuelle" : "Current Value"}
          value={currentValue !== null ? `${currentValue.toFixed(2)} τ` : "—"}
          color={pnlColor} />
        <MetricBox label="P&L"
          value={pnlPct !== null ? `${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}
          color={pnlColor} />
        <MetricBox label={fr ? "Distance stop" : "Stop distance"}
          value={stopDist !== null ? `${stopDist.toFixed(1)}%` : "—"}
          color={stopDist !== null && stopDist < 3 ? "rgba(229,57,53,0.9)" : "rgba(255,255,255,0.4)"} />
      </div>

      {/* Progress bar SL → TP */}
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        {pnlPct !== null && (
          <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{
            width: `${clamp(((pnlPct - pos.stop_loss_pct) / (pos.take_profit_pct - pos.stop_loss_pct)) * 100, 0, 100)}%`,
            background: pnlPct > 0 ? "rgba(76,175,80,0.6)" : "rgba(229,57,53,0.6)",
          }} />
        )}
      </div>
      <div className="flex justify-between font-mono text-[9px] text-white/25">
        <span>SL {pos.stop_loss_pct}%</span>
        <span>TP +{pos.take_profit_pct}%</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button onClick={() => livePrice && onClose(pos.id, livePrice)}
          className="font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-lg transition-all hover:scale-105"
          style={{ background: "rgba(229,57,53,0.15)", color: "rgba(229,57,53,0.9)", border: "1px solid rgba(229,57,53,0.3)" }}>
          {fr ? "FERMER" : "CLOSE"}
        </button>
      </div>
    </div>
  );
}

function MetricBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[8px] tracking-[0.15em] uppercase text-white/25">{label}</span>
      <span className="font-mono text-sm font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*  OPEN POSITION MODAL                    */
/* ═══════════════════════════════════════ */
function OpenPositionModal({
  subnets, livePrices, lang, onOpen, onCancel,
}: {
  subnets: { netuid: number; name: string }[];
  livePrices: Map<number, number>;
  lang: string;
  onOpen: (p: { netuid: number; capital: number; entry_price: number; stop_loss_pct: number; take_profit_pct: number }) => void;
  onCancel: () => void;
}) {
  const fr = lang === "fr";
  const [netuid, setNetuid] = useState(subnets[0]?.netuid ?? 1);
  const [capital, setCapital] = useState(10);
  const [objective, setObjective] = useState<"x2" | "x5" | "x10" | "x20">("x2");
  const [stopMode, setStopMode] = useState<"dynamic" | "manual">("dynamic");
  const [manualSL, setManualSL] = useState(-5);

  const tpMap = { x2: 100, x5: 400, x10: 900, x20: 1900 };
  const slMap = { x2: -10, x5: -15, x10: -20, x20: -25 };
  const tp = tpMap[objective];
  const sl = stopMode === "dynamic" ? slMap[objective] : manualSL;
  const price = livePrices.get(netuid) ?? 0;
  const qty = price > 0 ? capital / price : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()} style={{
        background: "rgba(10,10,14,0.98)", border: "1px solid rgba(255,215,0,0.15)",
      }}>
        <h2 className="font-mono text-sm tracking-widest text-white/80">{fr ? "OUVRIR UNE POSITION" : "OPEN POSITION"}</h2>

        {/* Subnet select */}
        <div>
          <label className="font-mono text-[9px] text-white/30 tracking-wider">SUBNET</label>
          <select value={netuid} onChange={e => setNetuid(Number(e.target.value))}
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white/80">
            {subnets.map(s => <option key={s.netuid} value={s.netuid}>SN-{s.netuid} — {s.name}</option>)}
          </select>
        </div>

        {/* Capital */}
        <div>
          <label className="font-mono text-[9px] text-white/30 tracking-wider">{fr ? "CAPITAL (TAO)" : "CAPITAL (TAO)"}</label>
          <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))} min={0.1} step={1}
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white/80" />
        </div>

        {/* Objective */}
        <div>
          <label className="font-mono text-[9px] text-white/30 tracking-wider">{fr ? "OBJECTIF" : "OBJECTIVE"}</label>
          <div className="flex gap-2 mt-1">
            {(["x2", "x5", "x10", "x20"] as const).map(o => (
              <button key={o} onClick={() => setObjective(o)}
                className="font-mono text-[11px] px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: objective === o ? "rgba(255,215,0,0.1)" : "rgba(255,255,255,0.03)",
                  color: objective === o ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.3)",
                  border: objective === o ? "1px solid rgba(255,215,0,0.3)" : "1px solid rgba(255,255,255,0.06)",
                }}>
                ×{o.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Stop mode */}
        <div>
          <label className="font-mono text-[9px] text-white/30 tracking-wider">{fr ? "MODE STOP" : "STOP MODE"}</label>
          <div className="flex gap-2 mt-1">
            {(["dynamic", "manual"] as const).map(m => (
              <button key={m} onClick={() => setStopMode(m)}
                className="font-mono text-[11px] px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: stopMode === m ? "rgba(255,215,0,0.1)" : "rgba(255,255,255,0.03)",
                  color: stopMode === m ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.3)",
                  border: stopMode === m ? "1px solid rgba(255,215,0,0.3)" : "1px solid rgba(255,255,255,0.06)",
                }}>
                {m === "dynamic" ? (fr ? "Trailing" : "Trailing") : (fr ? "Fixe" : "Fixed")}
              </button>
            ))}
          </div>
          {stopMode === "manual" && (
            <input type="number" value={manualSL} onChange={e => setManualSL(Number(e.target.value))} max={0} step={1}
              className="w-full mt-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white/80" />
          )}
        </div>

        {/* Summary */}
        <div className="rounded-lg p-3 space-y-1" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex justify-between font-mono text-[10px]">
            <span className="text-white/30">{fr ? "Prix d'entrée" : "Entry price"}</span>
            <span className="text-white/60">{price > 0 ? price.toFixed(4) : "—"} τ</span>
          </div>
          <div className="flex justify-between font-mono text-[10px]">
            <span className="text-white/30">{fr ? "Quantité est." : "Est. quantity"}</span>
            <span className="text-white/60">{qty > 0 ? qty.toFixed(2) : "—"}</span>
          </div>
          <div className="flex justify-between font-mono text-[10px]">
            <span className="text-white/30">SL / TP</span>
            <span className="text-white/60">{sl}% / +{tp}%</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button onClick={onCancel}
            className="flex-1 font-mono text-[11px] tracking-wider py-2.5 rounded-lg transition-all"
            style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {fr ? "ANNULER" : "CANCEL"}
          </button>
          <button onClick={() => price > 0 && onOpen({ netuid, capital, entry_price: price, stop_loss_pct: sl, take_profit_pct: tp })}
            disabled={price <= 0 || capital <= 0}
            className="flex-1 font-mono text-[11px] tracking-wider py-2.5 rounded-lg transition-all hover:scale-[1.02] disabled:opacity-30"
            style={{ background: "rgba(76,175,80,0.15)", color: "rgba(76,175,80,0.9)", border: "1px solid rgba(76,175,80,0.3)" }}>
            {fr ? "CONFIRMER" : "CONFIRM"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/*        HELPERS                          */
/* ═══════════════════════════════════════ */
function deriveRiskSimple(psi: number, conf: number, quality: number, state: string | null): number {
  let risk = 0;
  if (state === "BREAK" || state === "EXIT_FAST") risk += 40;
  else if (state === "HOLD") risk += 5;
  const qd = (100 - quality) / 100; risk += qd * qd * 30;
  const cd = (100 - conf) / 100; risk += cd * cd * 20;
  if (psi >= 80 && quality < 50) risk += 15;
  if (psi < 25) risk += 8;
  return Math.round(clamp(risk, 0, 100));
}

function deriveSCSimple(psi: number, quality: number, conf: number, state: string | null): "ACCUMULATION" | "STABLE" | "DISTRIBUTION" {
  const acc = quality * 0.5 + conf * 0.3 + clamp(psi * 0.2, 0, 20);
  const dist = clamp((100 - quality) * 0.4, 0, 40) + (psi >= 80 && quality < 50 ? 30 : 0) + (state === "BREAK" || state === "EXIT_FAST" ? 25 : 0);
  const score = clamp(acc - dist * 0.5 + 30, 0, 100);
  if (score >= 65) return "ACCUMULATION";
  if (score <= 35) return "DISTRIBUTION";
  return "STABLE";
}

/* ═══════════════════════════════════════ */
/*        MAIN PAGE                        */
/* ═══════════════════════════════════════ */
export default function PortfolioPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const { user } = useAuth();
  const { data: positions, isLoading } = usePositions();
  const openPosition = useOpenPosition();
  const closePosition = useClosePosition();
  const [showModal, setShowModal] = useState(false);

  // Live prices
  const { data: livePrices } = useQuery({
    queryKey: ["portfolio-live-prices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subnet_latest_display").select("netuid, price, source");
      if (error) throw error;
      const map = new Map<number, number>();
      for (const r of data || []) {
        if (r.netuid && r.price && !map.has(r.netuid)) map.set(r.netuid, Number(r.price));
      }
      return map;
    },
    refetchInterval: 30_000,
  });

  // Signals for SC/risk
  const { data: signals } = useQuery({
    queryKey: ["portfolio-signals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("netuid, state, mpi, score, confidence_pct, quality_score");
      if (error) throw error;
      return (data || []) as SignalRow[];
    },
    refetchInterval: 60_000,
  });

  // Subnet names for modal
  const { data: subnetList } = useQuery({
    queryKey: ["subnet-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subnets").select("netuid, name").order("netuid");
      if (error) throw error;
      return (data || []).map(s => ({ netuid: s.netuid, name: s.name || `SN-${s.netuid}` }));
    },
  });

  const signalMap = useMemo(() => {
    const m = new Map<number, SignalRow>();
    for (const s of signals || []) { if (s.netuid) m.set(s.netuid, s); }
    return m;
  }, [signals]);

  // Portfolio totals
  const totals = useMemo(() => {
    if (!positions?.length || !livePrices) return { invested: 0, current: 0, pnl: 0, pnlPct: 0 };
    let invested = 0, current = 0;
    for (const p of positions) {
      invested += p.capital;
      const price = livePrices.get(p.netuid);
      current += price ? p.quantity * price : p.capital;
    }
    const pnl = current - invested;
    return { invested, current, pnl, pnlPct: invested > 0 ? (pnl / invested) * 100 : 0 };
  }, [positions, livePrices]);

  const handleOpen = async (params: { netuid: number; capital: number; entry_price: number; stop_loss_pct: number; take_profit_pct: number }) => {
    try {
      await openPosition.mutateAsync(params);
      setShowModal(false);
      toast.success(fr ? "Position ouverte ✓" : "Position opened ✓");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleClose = async (id: string, price: number) => {
    try {
      await closePosition.mutateAsync({ id, closed_price: price });
      toast.success(fr ? "Position fermée ✓" : "Position closed ✓");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!user) {
    return (
      <div className="h-full w-full bg-[#000] text-white flex items-center justify-center p-6 pt-14">
        <div className="text-center space-y-4">
          <span className="font-mono text-3xl">🔒</span>
          <p className="font-mono text-sm text-white/50">
            {fr ? "Connectez-vous pour gérer votre portefeuille" : "Sign in to manage your portfolio"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <h1 className="font-mono text-lg sm:text-xl tracking-widest text-white/85 mb-5 sm:mb-7">
        {fr ? "Portefeuille" : "Portfolio"}
      </h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <SummaryCard label={fr ? "Capital investi" : "Invested"} value={`${totals.invested.toFixed(2)} τ`} color="rgba(255,215,0,0.7)" />
        <SummaryCard label={fr ? "Valeur actuelle" : "Current Value"} value={`${totals.current.toFixed(2)} τ`}
          color={totals.pnl >= 0 ? "rgba(76,175,80,0.9)" : "rgba(229,57,53,0.9)"} />
        <SummaryCard label="P&L"
          value={`${totals.pnl >= 0 ? "+" : ""}${totals.pnl.toFixed(2)} τ`}
          color={totals.pnl >= 0 ? "rgba(76,175,80,0.9)" : "rgba(229,57,53,0.9)"} />
        <SummaryCard label="P&L %"
          value={`${totals.pnlPct >= 0 ? "+" : ""}${totals.pnlPct.toFixed(1)}%`}
          color={totals.pnlPct >= 0 ? "rgba(76,175,80,0.9)" : "rgba(229,57,53,0.9)"} />
      </div>

      {/* Open position button */}
      <button onClick={() => setShowModal(true)}
        className="mb-6 font-mono text-[11px] tracking-wider px-5 py-2.5 rounded-lg transition-all hover:scale-105"
        style={{
          background: "linear-gradient(135deg, rgba(76,175,80,0.15), rgba(76,175,80,0.08))",
          color: "rgba(76,175,80,0.9)",
          border: "1px solid rgba(76,175,80,0.3)",
          boxShadow: "0 0 15px rgba(76,175,80,0.08)",
        }}>
        ➕ {fr ? "Ouvrir une position" : "Open a position"}
      </button>

      {/* Positions list */}
      {isLoading ? (
        <div className="font-mono text-xs text-white/30 text-center py-12">{fr ? "Chargement…" : "Loading…"}</div>
      ) : !positions?.length ? (
        <div className="text-center py-16 space-y-3">
          <span className="text-3xl">📊</span>
          <p className="font-mono text-xs text-white/35">{fr ? "Aucune position ouverte" : "No open positions"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map(p => (
            <PositionCard key={p.id} pos={p}
              livePrice={livePrices?.get(p.netuid) ?? null}
              signal={signalMap.get(p.netuid) ?? null}
              lang={lang} onClose={handleClose} />
          ))}
        </div>
      )}

      {/* Open position modal */}
      {showModal && subnetList && livePrices && (
        <OpenPositionModal subnets={subnetList} livePrices={livePrices}
          lang={lang} onOpen={handleOpen} onCancel={() => setShowModal(false)} />
      )}
    </div>
  );
}

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
