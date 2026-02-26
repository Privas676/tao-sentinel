import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function normalize(v: number, max: number) { return clamp(v / max, 0, 1); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date();
    const nowIso = now.toISOString();
    const ago30m = new Date(now.getTime() - 30 * 60000).toISOString();
    const ago1h = new Date(now.getTime() - 60 * 60000).toISOString();
    const ago10m = new Date(now.getTime() - 10 * 60000).toISOString();

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

      // 30m window for averages
      const { data: window30m } = await sb.from("subnet_metrics_ts")
        .select("flow_3m, flow_5m, flow_6m, flow_15m, daily_chain_buys_3m, price, liquidity, miners_active")
        .eq("netuid", netuid).gte("ts", ago30m).order("ts", { ascending: true });

      // Previous snapshot (for consecutive BREAK detection)
      const { data: prevSnapshot } = await sb.from("subnet_metrics_ts").select("flow_3m, price, liquidity")
        .eq("netuid", netuid).order("ts", { ascending: false }).limit(2);

      // 1h ago for miner delta
      const { data: snap1h } = await sb.from("subnet_metrics_ts").select("miners_active, price, liquidity")
        .eq("netuid", netuid).lte("ts", ago1h).order("ts", { ascending: false }).limit(1).maybeSingle();

      // Deltas
      const ago6m = new Date(now.getTime() - 6 * 60000).toISOString();
      const ago15m = new Date(now.getTime() - 15 * 60000).toISOString();
      const ago5m = new Date(now.getTime() - 5 * 60000).toISOString();
      const ago3m = new Date(now.getTime() - 3 * 60000).toISOString();

      const { data: snap6m } = await sb.from("subnet_metrics_ts").select("price, liquidity")
        .eq("netuid", netuid).lte("ts", ago6m).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: snap15m } = await sb.from("subnet_metrics_ts").select("price, liquidity, flow_5m")
        .eq("netuid", netuid).lte("ts", ago15m).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: snap5m } = await sb.from("subnet_metrics_ts").select("price")
        .eq("netuid", netuid).lte("ts", ago5m).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: snap3m } = await sb.from("subnet_metrics_ts").select("liquidity")
        .eq("netuid", netuid).lte("ts", ago3m).order("ts", { ascending: false }).limit(1).maybeSingle();

      const w = window30m || [];

      // === FLOW RATIOS ===
      const flow3m = latest.flow_3m || 0;
      const flow6m = latest.flow_6m || 0;
      const flow15m = latest.flow_15m || 0;
      const avgFlow3m = w.length > 0 ? w.reduce((s, r) => s + (r.flow_3m || 0), 0) / w.length : 0;
      const avgFlow6m = w.length > 0 ? w.reduce((s, r) => s + (r.flow_6m || 0), 0) / w.length : 0;
      const avgFlow15m = w.length > 0 ? w.reduce((s, r) => s + (r.flow_15m || 0), 0) / w.length : 0;

      const flowRatio3m = avgFlow3m > 0 ? flow3m / avgFlow3m : 0;
      const flowRatio6m = avgFlow6m > 0 ? flow6m / avgFlow6m : 0;
      const flowRatio15m = avgFlow15m > 0 ? flow15m / avgFlow15m : 0;

      // Flow Structure Score
      let flowStructureScore = 0;
      if (flowRatio3m > flowRatio6m && flowRatio6m > flowRatio15m) flowStructureScore = 1;
      else if (flowRatio3m > flowRatio6m) flowStructureScore = 0.5;

      // === BUYS RATIO ===
      const buys3m = latest.daily_chain_buys_3m || 0;
      const avgBuys3m = w.length > 0 ? w.reduce((s, r) => s + (r.daily_chain_buys_3m || 0), 0) / w.length : 0;
      const buysRatio3m = avgBuys3m > 0 ? buys3m / avgBuys3m : 0;

      // === PRICE COMPRESSION ===
      const priceNow = latest.price || 0;
      const price6m = snap6m?.price || priceNow;
      const priceChange6m = price6m > 0 ? ((priceNow - price6m) / price6m) : 0;
      const priceAbs6m = Math.abs(priceChange6m);
      const priceCompressionScore = clamp(1 - priceAbs6m / 0.03, 0, 1);

      // === LIQUIDITY STABILITY ===
      const liqNow = latest.liquidity || 0;
      const liq15m = snap15m?.liquidity || liqNow;
      const liqChange15m = liq15m > 0 ? ((liqNow - liq15m) / liq15m) * 100 : 0;
      let liquidityStabilityScore = 0;
      if (liqChange15m >= -3) liquidityStabilityScore = 1;
      else if (liqChange15m >= -6) liquidityStabilityScore = 0.5;

      // === MINER FILTER ===
      const minersNow = latest.miners_active || 0;
      const miners1h = snap1h?.miners_active || minersNow;
      const minersDelta1h = miners1h > 0 ? (minersNow - miners1h) / miners1h : 0;

      let minerFilter: "PASS" | "WARN" | "FAIL";
      if (minersDelta1h <= -0.05) minerFilter = "FAIL";
      else if (minersDelta1h < 0) minerFilter = "WARN";
      else minerFilter = "PASS";

      // === MINER BONUS ===
      const minerBonus = minerFilter === "PASS" ? 10 : minerFilter === "WARN" ? 5 : 0;

      // === RISK PENALTIES ===
      const liq6m = snap6m?.liquidity || liqNow;
      const liqChange6m = liq6m > 0 ? ((liqNow - liq6m) / liq6m) * 100 : 0;
      const price5m = snap5m?.price || priceNow;
      const priceChange5m = price5m > 0 ? ((priceNow - price5m) / price5m) * 100 : 0;

      let riskPenalties = 0;
      if (liqChange6m < -5) riskPenalties += 8;
      if (priceChange5m <= -4) riskPenalties += 7;

      // === OPERATOR SCORE ===
      let score = Math.round(
        35 * normalize(flowRatio3m, 3) +
        15 * flowStructureScore +
        20 * normalize(buysRatio3m, 3) +
        15 * priceCompressionScore +
        15 * liquidityStabilityScore +
        minerBonus -
        riskPenalties
      );
      score = clamp(score, 0, 100);

      // === EXISTING SIGNAL ===
      const { data: existingSignal } = await sb.from("signals").select("*")
        .eq("netuid", netuid).maybeSingle();
      const prevState = existingSignal?.state || "NO";
      const prevScore = existingSignal?.score || 0;

      // === STATE LOGIC ===
      let newState = "NO";
      let reasons: string[] = [];
      let eventType: string | null = null;
      let severity = 0;

      const isActive = ["GO", "GO_SPECULATIVE", "HOLD"].includes(prevState);

      // BREAK detection (highest priority for active positions)
      const liq3m = snap3m?.liquidity || liqNow;
      const liqChange3m = liq3m > 0 ? ((liqNow - liq3m) / liq3m) * 100 : 0;
      const price15m = snap15m?.price || priceNow;
      const priceChange15m = price15m > 0 ? ((priceNow - price15m) / price15m) * 100 : 0;

      // Check consecutive flow breakdown
      const prevSnapshots = prevSnapshot || [];
      const flowConsecutiveBreak = prevSnapshots.length >= 2 &&
        avgFlow3m > 0 &&
        (prevSnapshots[0]?.flow_3m || 0) < avgFlow3m &&
        (prevSnapshots[1]?.flow_3m || 0) < avgFlow3m;

      // Score drop in 10 min
      const { data: snap10m } = await sb.from("signals").select("score")
        .eq("netuid", netuid).maybeSingle();
      const scoreDrop = (snap10m?.score || prevScore) - score;

      const breakConditions: string[] = [];
      if (flowConsecutiveBreak) breakConditions.push("Flow breakdown detected");
      if (liqChange3m < -5) breakConditions.push("Liquidity shock detected");
      if (priceChange5m <= -4) breakConditions.push("Price dropped sharply");
      if (scoreDrop >= 15) breakConditions.push("Score dropped rapidly");
      if (minerFilter === "FAIL" && prevState !== "NO" && prevState !== "WATCH") breakConditions.push("Miner became FAIL");

      if (isActive && breakConditions.length > 0) {
        newState = "EXIT_FAST";
        reasons = breakConditions.slice(0, 3);
        const lastNotif = existingSignal?.last_notified_at;
        const canNotify = !lastNotif || (now.getTime() - new Date(lastNotif).getTime() > 15 * 60000);
        if (canNotify) { eventType = "BREAK"; severity = 3; }
      }
      // GO
      else if (score >= 80 && flowStructureScore >= 0.5 && liquidityStabilityScore >= 0.5 && minerFilter !== "FAIL") {
        newState = "GO";
        reasons = [];
        if (flowStructureScore === 1) reasons.push("Flow acceleration confirmed");
        if (buysRatio3m > 1.5) reasons.push("Strong buy pressure");
        if (priceCompressionScore > 0.8) reasons.push("Price compression before breakout");
        if (liquidityStabilityScore === 1) reasons.push("Liquidity stable");
        if (minerFilter === "PASS") reasons.push("Miner stability strong");
        reasons = reasons.slice(0, 3);

        const lastNotif = existingSignal?.last_notified_at;
        const canGo = !lastNotif || (now.getTime() - new Date(lastNotif).getTime() > 30 * 60000);
        if (canGo) { eventType = "GO"; severity = 2; }
      }
      // GO_SPECULATIVE
      else if (score >= 72 && score <= 79 && flowStructureScore === 1 && minerFilter === "WARN") {
        newState = "GO_SPECULATIVE";
        reasons = ["Flow acceleration confirmed", "Miner filter WARN"];
        if (buysRatio3m > 1.3) reasons.push("Strong buy pressure");
        reasons = reasons.slice(0, 3);

        const lastNotif = existingSignal?.last_notified_at;
        const canGo = !lastNotif || (now.getTime() - new Date(lastNotif).getTime() > 30 * 60000);
        if (canGo) { eventType = "GO_SPECULATIVE"; severity = 2; }
      }
      // HOLD
      else if (score >= 70 && priceChange15m >= 6 && (latest.flow_5m || 0) >= 1.2 * (w.length > 0 ? w.reduce((s, r) => s + (r.flow_5m || 0), 0) / w.length : 1)) {
        newState = "HOLD";
        reasons = [`Price +${priceChange15m.toFixed(1)}% 15m`, "Flow sustained", "Liquidity stable"];
        const lastNotif = existingSignal?.last_notified_at;
        const canNotify = !lastNotif || (now.getTime() - new Date(lastNotif).getTime() > 60 * 60000);
        if (canNotify && prevState !== "HOLD") { eventType = "HOLD"; severity = 2; }
      }
      // WATCH
      else if (score >= 55 && score <= 70) {
        newState = "WATCH";
        reasons = ["Partial signal conditions"];
        if (flowRatio3m > 1) reasons.push(`Flow ${flowRatio3m.toFixed(1)}x avg`);
        reasons = reasons.slice(0, 3);
      }
      // NO
      else {
        newState = prevState === "EXIT_FAST" ? "EXIT_FAST" : "NO";
        reasons = [];
      }

      // === DEPEG Detection ===
      const price1h = snap1h?.price || priceNow;
      const priceChange1h = price1h > 0 ? ((priceNow - price1h) / price1h) * 100 : 0;
      const liq1h = snap1h?.liquidity || liqNow;
      const liqChange1h = liq1h > 0 ? ((liqNow - liq1h) / liq1h) * 100 : 0;

      if (priceChange5m <= -6 && liqChange1h <= -15) {
        await sb.from("events").insert({ netuid, ts: nowIso, type: "DEPEG_CRITICAL", severity: 4, evidence: { priceChange5m, priceChange1h, liqChange1h } });
      } else if (priceChange5m <= -6 || priceChange1h <= -12) {
        await sb.from("events").insert({ netuid, ts: nowIso, type: "DEPEG_WARNING", severity: 3, evidence: { priceChange5m, priceChange1h } });
      }

      // === Upsert signal ===
      const signalData: any = { netuid, ts: nowIso, state: newState, score, reasons, miner_filter: minerFilter };
      if (newState !== prevState) signalData.last_state_change_at = nowIso;
      if (eventType) signalData.last_notified_at = nowIso;

      await sb.from("signals").upsert(signalData, { onConflict: "netuid" });

      if (eventType) {
        await sb.from("events").insert({
          netuid, ts: nowIso, type: eventType, severity,
          evidence: { score, reasons, minerFilter, flowRatio3m, flowStructureScore, buysRatio3m, priceCompressionScore, liquidityStabilityScore, minerBonus, riskPenalties },
        });
      }

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
