import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function scoreClip(x: number, lo: number, hi: number) { return 100 * clamp((x - lo) / (hi - lo), 0, 1); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date();
    const nowIso = now.toISOString();
    const ago5m = new Date(now.getTime() - 5 * 60000).toISOString();
    const ago1h = new Date(now.getTime() - 60 * 60000).toISOString();
    const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60000).toISOString();

    const { data: subnets } = await sb.from("subnets").select("netuid");
    if (!subnets?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const { netuid } of subnets) {
      // Latest snapshot
      const { data: latest } = await sb.from("subnet_metrics_ts").select("*")
        .eq("netuid", netuid).order("ts", { ascending: false }).limit(1).maybeSingle();
      if (!latest) continue;

      // 5m ago snapshot
      const { data: snap5m } = await sb.from("subnet_metrics_ts").select("price, liquidity, miners_active")
        .eq("netuid", netuid).lte("ts", ago5m).order("ts", { ascending: false }).limit(1).maybeSingle();

      // 1h ago snapshot
      const { data: snap1h } = await sb.from("subnet_metrics_ts").select("price, liquidity, miners_active")
        .eq("netuid", netuid).lte("ts", ago1h).order("ts", { ascending: false }).limit(1).maybeSingle();

      // 7d price max for breakout
      const { data: prices7d } = await sb.from("subnet_metrics_ts").select("price")
        .eq("netuid", netuid).gte("ts", ago7d).order("ts", { ascending: true });

      const priceNow = Number(latest.price) || 0;
      const price5m = Number(snap5m?.price) || priceNow;
      const price1h = Number(snap1h?.price) || priceNow;
      const minersNow = Number(latest.miners_active) || 0;
      const miners1h = Number(snap1h?.miners_active) || minersNow;
      const liqNow = Number(latest.liquidity) || 0;
      const topMinersShare = Number(latest.top_miners_share) || 0;

      // Approximate unavailable fields with sensible defaults
      const minerBurnPct = 0; // Not available
      const deregRank = 999; // Not available, safe default
      const repoInactive = false;
      const xInactive = false;
      const discordInactive = false;
      const whaleImpactPct = topMinersShare * 100; // approximate
      const gini = Math.min(topMinersShare * 1.2, 1); // approximate

      // Liquidity haircut: % change from 1h ago
      const liq1h = Number(snap1h?.liquidity) || liqNow;
      const liqHaircut = liq1h > 0 ? ((liqNow - liq1h) / liq1h) * 100 : 0;

      // ============= 1. GATING =============
      const gatingFail =
        minerBurnPct === 100 ||
        deregRank <= 5 ||
        minersNow === 0 ||
        liqHaircut <= -60;

      // ============= 2. QUALITY SCORE (Q) =============
      let penalty = 0;
      if (whaleImpactPct >= 30) penalty += 25;
      if (gini >= 0.75) penalty += 20;
      if (repoInactive) penalty += 15;
      if (xInactive && discordInactive) penalty += 10;
      const Q = clamp(100 - penalty, 0, 100);

      // ============= 3. MOMENTUM (M) =============
      const r5m = priceNow > 0 && price5m > 0 ? Math.log(priceNow / price5m) : 0;
      const r1h = priceNow > 0 && price1h > 0 ? Math.log(priceNow / price1h) : 0;
      const M = 0.4 * scoreClip(r1h, -0.02, 0.04) + 0.6 * scoreClip(r5m, -0.004, 0.010);

      // ============= 4. ADOPTION (A) =============
      const minersDelta = minersNow - miners1h;
      const A = scoreClip(minersDelta, -5, 25);

      // ============= 5. LIQUIDITY SAFETY (L) =============
      const L = liqHaircut !== 0 ? 100 - scoreClip(Math.abs(liqHaircut), 0, 60) : 50;

      // ============= 6. BREAKOUT (B) =============
      const priceMax7d = (prices7d || []).reduce((max, r) => Math.max(max, Number(r.price) || 0), 0);
      const breakout = priceNow > priceMax7d && priceMax7d > 0;
      const B = breakout ? 100 : 0;

      // ============= 7. MPI =============
      const mpi = clamp(Math.round(
        0.30 * M +
        0.20 * A +
        0.15 * L +
        0.15 * B +
        0.20 * Q
      ), 0, 100);

      // ============= 8. DECISION LOGIC =============
      const { data: existingSignal } = await sb.from("signals").select("*")
        .eq("netuid", netuid).maybeSingle();
      const prevState = existingSignal?.state || "NO";

      let newState: string;
      let reasons: string[] = [];
      let eventType: string | null = null;
      let severity = 0;

      if (gatingFail) {
        newState = "BREAK";
        reasons = [];
        if (minersNow === 0) reasons.push("Zero miners");
        if (liqHaircut <= -60) reasons.push("Liquidity collapse");
        if (minerBurnPct === 100) reasons.push("100% miner burn");
        if (deregRank <= 5) reasons.push("Near deregistration");
        const canNotify = !existingSignal?.last_notified_at ||
          (now.getTime() - new Date(existingSignal.last_notified_at).getTime() > 15 * 60000);
        if (canNotify && prevState !== "BREAK") { eventType = "BREAK"; severity = 3; }
      }
      else if (mpi >= 85 && M >= 65 && Q >= 60) {
        newState = "GO";
        reasons = ["High MPI", `Momentum ${Math.round(M)}`, `Quality ${Q}`];
        if (breakout) reasons.push("7d breakout");
        reasons = reasons.slice(0, 3);
        const canGo = !existingSignal?.last_notified_at ||
          (now.getTime() - new Date(existingSignal.last_notified_at).getTime() > 30 * 60000);
        if (canGo) { eventType = "GO"; severity = 2; }
      }
      else if (mpi >= 72 && M >= 55 && Q >= 55) {
        newState = "EARLY";
        reasons = ["Early momentum detected", `MPI ${mpi}`, `Quality ${Q}`];
        if (breakout) reasons.push("Approaching breakout");
        reasons = reasons.slice(0, 3);
        // Anti-spam: 60min cooldown for EARLY unless upgrading to GO
        const lastChange = existingSignal?.last_state_change_at;
        const cooldownOk = !lastChange || prevState !== "EARLY" ||
          (now.getTime() - new Date(lastChange).getTime() > 60 * 60000);
        if (cooldownOk) {
          const canNotify = !existingSignal?.last_notified_at ||
            (now.getTime() - new Date(existingSignal.last_notified_at).getTime() > 60 * 60000);
          if (canNotify) { eventType = "EARLY"; severity = 2; }
        } else {
          // Still in cooldown, stay at previous state
          newState = prevState === "EARLY" ? "EARLY" : prevState;
        }
      }
      else if (mpi >= 55) {
        newState = "WATCH";
        reasons = [`MPI ${mpi}`, "Partial conditions"];
      }
      else if (mpi >= 40) {
        newState = "HOLD";
        reasons = [`MPI ${mpi}`];
      }
      else {
        newState = prevState === "BREAK" ? "BREAK" : "BREAK";
        reasons = ["Low MPI"];
      }

      // ============= 9. CONFIDENCE =============
      const confSignal = clamp((mpi - 60) / 40, 0, 1);
      const confQuality = Q / 100;
      const confidencePct = Math.round(100 * (0.55 * confSignal + 0.45 * confQuality));

      // ============= DEPEG Detection =============
      const priceChange5m = price5m > 0 ? ((priceNow - price5m) / price5m) * 100 : 0;
      const priceChange1h = price1h > 0 ? ((priceNow - price1h) / price1h) * 100 : 0;
      const liqChange1h = liq1h > 0 ? ((liqNow - liq1h) / liq1h) * 100 : 0;

      if (priceChange5m <= -6 && liqChange1h <= -15) {
        await sb.from("events").insert({ netuid, ts: nowIso, type: "DEPEG_CRITICAL", severity: 4, evidence: { priceChange5m, priceChange1h, liqChange1h } });
      } else if (priceChange5m <= -6 || priceChange1h <= -12) {
        await sb.from("events").insert({ netuid, ts: nowIso, type: "DEPEG_WARNING", severity: 3, evidence: { priceChange5m, priceChange1h } });
      }

      // ============= Upsert signal =============
      const signalData: any = {
        netuid, ts: nowIso, state: newState, score: mpi, mpi, confidence_pct: confidencePct,
        quality_score: Q, reasons, miner_filter: minersNow > 0 ? (minersDelta >= 0 ? "PASS" : "WARN") : "FAIL",
      };
      if (newState !== prevState) signalData.last_state_change_at = nowIso;
      if (eventType) signalData.last_notified_at = nowIso;

      await sb.from("signals").upsert(signalData, { onConflict: "netuid" });

      if (eventType) {
        await sb.from("events").insert({
          netuid, ts: nowIso, type: eventType, severity,
          evidence: { mpi, confidencePct, M: Math.round(M), A: Math.round(A), L: Math.round(L), B, Q, reasons },
        });
      }

      // ============= Daily price snapshot =============
      const today = now.toISOString().split("T")[0];
      await sb.from("subnet_price_daily").upsert(
        { netuid, date: today, price_close: priceNow, price_high: Math.max(priceNow, priceMax7d || 0), price_low: priceNow },
        { onConflict: "netuid,date" }
      );

      processed++;
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("compute-signals error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
