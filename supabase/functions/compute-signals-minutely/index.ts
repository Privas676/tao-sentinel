import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date();
    const nowIso = now.toISOString();
    const ago30m = new Date(now.getTime() - 30 * 60000).toISOString();
    const ago1h = new Date(now.getTime() - 60 * 60000).toISOString();

    // Get all subnets
    const { data: subnets } = await sb.from("subnets").select("netuid");
    if (!subnets?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const { netuid } of subnets) {
      // Get latest metrics
      const { data: latest } = await sb
        .from("subnet_metrics_ts")
        .select("*")
        .eq("netuid", netuid)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latest) continue;

      // Get 30-min window for averages
      const { data: window30m } = await sb
        .from("subnet_metrics_ts")
        .select("flow_3m, flow_5m, daily_chain_buys_3m, price, liquidity, miners_active, top_miners_share")
        .eq("netuid", netuid)
        .gte("ts", ago30m)
        .order("ts", { ascending: true });

      // Get 1h ago snapshot for miner delta
      const { data: snap1h } = await sb
        .from("subnet_metrics_ts")
        .select("miners_active, price, liquidity")
        .eq("netuid", netuid)
        .lte("ts", ago1h)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get snapshots for short deltas
      const ago6m = new Date(now.getTime() - 6 * 60000).toISOString();
      const ago15m = new Date(now.getTime() - 15 * 60000).toISOString();
      const ago5m = new Date(now.getTime() - 5 * 60000).toISOString();
      const ago3m = new Date(now.getTime() - 3 * 60000).toISOString();

      const { data: snap6m } = await sb.from("subnet_metrics_ts").select("price, liquidity")
        .eq("netuid", netuid).lte("ts", ago6m).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: snap15m } = await sb.from("subnet_metrics_ts").select("price, liquidity, flow_5m")
        .eq("netuid", netuid).lte("ts", ago15m).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: snap5m } = await sb.from("subnet_metrics_ts").select("price, score_snapshot:id")
        .eq("netuid", netuid).lte("ts", ago5m).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: snap3m } = await sb.from("subnet_metrics_ts").select("liquidity")
        .eq("netuid", netuid).lte("ts", ago3m).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: snap30m } = await sb.from("subnet_metrics_ts").select("price")
        .eq("netuid", netuid).lte("ts", ago30m).order("ts", { ascending: false }).limit(1).maybeSingle();

      const w = window30m || [];
      const avgFlow3m = w.length > 0 ? w.reduce((s, r) => s + (r.flow_3m || 0), 0) / w.length : 0;
      const avgFlow5m = w.length > 0 ? w.reduce((s, r) => s + (r.flow_5m || 0), 0) / w.length : 0;
      const avgBuys3m = w.length > 0 ? w.reduce((s, r) => s + (r.daily_chain_buys_3m || 0), 0) / w.length : 0;

      // === A) MINER FILTER ===
      const minersNow = latest.miners_active || 0;
      const miners1h = snap1h?.miners_active || minersNow;
      const minersDelta1h = miners1h > 0 ? (minersNow - miners1h) / miners1h : 0;
      const topShare = latest.top_miners_share || 0;

      let minerFilter: "PASS" | "WARN" | "FAIL";
      if (minersDelta1h <= -0.05 || topShare > 70) {
        minerFilter = "FAIL";
      } else if (minersDelta1h < 0 || topShare > 55) {
        minerFilter = "WARN";
      } else {
        minerFilter = "PASS";
      }

      // Get existing signal
      const { data: existingSignal } = await sb.from("signals").select("*")
        .eq("netuid", netuid).maybeSingle();

      const prevState = existingSignal?.state || "NO";
      const prevScore = existingSignal?.score || 0;

      // === Price/liquidity deltas ===
      const priceNow = latest.price || 0;
      const price6m = snap6m?.price || priceNow;
      const price15m = snap15m?.price || priceNow;
      const price30m = snap30m?.price || priceNow;
      const price5m = snap5m?.price || priceNow;

      const priceChange6m = price6m > 0 ? ((priceNow - price6m) / price6m) * 100 : 0;
      const priceChange15m = price15m > 0 ? ((priceNow - price15m) / price15m) * 100 : 0;
      const priceChange30m = price30m > 0 ? ((priceNow - price30m) / price30m) * 100 : 0;
      const priceChange5m = price5m > 0 ? ((priceNow - price5m) / price5m) * 100 : 0;

      const liqNow = latest.liquidity || 0;
      const liq6m = snap6m?.liquidity || liqNow;
      const liq15m = snap15m?.liquidity || liqNow;
      const liq3m = snap3m?.liquidity || liqNow;
      const liqChange6m = liq6m > 0 ? ((liqNow - liq6m) / liq6m) * 100 : 0;
      const liqChange15m = liq15m > 0 ? ((liqNow - liq15m) / liq15m) * 100 : 0;
      const liqChange3m = liq3m > 0 ? ((liqNow - liq3m) / liq3m) * 100 : 0;

      const flow3m = latest.flow_3m || 0;
      const buys3m = latest.daily_chain_buys_3m || 0;
      const flow5m = latest.flow_5m || 0;

      // === D) EXIT_FAST ENGINE (check first — highest priority) ===
      let newState = prevState;
      let reasons: string[] = [];
      let score = prevScore;
      let eventType: string | null = null;
      let severity = 0;

      const isActive = ["GO", "GO_SPECULATIVE", "HOLD"].includes(prevState);

      if (isActive) {
        const exitReasons: string[] = [];
        if (avgFlow3m > 0 && flow3m < avgFlow3m) exitReasons.push("Flow collapse");
        if (avgBuys3m > 0 && buys3m < avgBuys3m) exitReasons.push("Buys collapse");
        if (liqChange3m < -5) exitReasons.push(`Liq drop ${liqChange3m.toFixed(1)}%`);
        if (priceChange5m <= -4) exitReasons.push(`Price drop ${priceChange5m.toFixed(1)}%`);
        // Score drop check would need previous score from 5m ago — approximate
        if (exitReasons.length > 0) {
          // Check dedup: 15min
          const lastExit = existingSignal?.last_notified_at;
          const canNotify = !lastExit || (now.getTime() - new Date(lastExit).getTime() > 15 * 60000);

          newState = "EXIT_FAST";
          reasons = exitReasons.slice(0, 3);
          score = Math.max(0, prevScore - 30);
          if (canNotify) {
            eventType = "EXIT_FAST";
            severity = 3;
          }
        }
      }

      // === C) HOLD ENGINE ===
      if (newState !== "EXIT_FAST" && isActive) {
        const holdConditions =
          (priceChange15m >= 6 || priceChange30m >= 10) &&
          avgFlow5m > 0 && flow5m > avgFlow5m * 1.2 &&
          liqChange15m > -5;

        if (holdConditions) {
          newState = "HOLD";
          reasons = [
            priceChange15m >= 6 ? `Price +${priceChange15m.toFixed(1)}% 15m` : `Price +${priceChange30m.toFixed(1)}% 30m`,
            "Flow sustained",
            "Liquidity stable",
          ];
          // Dedup: 60min
          const lastHoldNotif = existingSignal?.last_notified_at;
          const canNotifyHold = !lastHoldNotif || (now.getTime() - new Date(lastHoldNotif).getTime() > 60 * 60000);
          if (canNotifyHold && prevState !== "HOLD") {
            eventType = "HOLD";
            severity = 2;
          }
        }
      }

      // === B) GO ENGINE ===
      if (newState !== "EXIT_FAST" && newState !== "HOLD") {
        const goConditions =
          avgFlow3m > 0 && flow3m > avgFlow3m * 1.15 &&
          avgBuys3m > 0 && buys3m > avgBuys3m * 1.15 &&
          Math.abs(priceChange6m) < 2.5 &&
          liqChange6m > -4;

        if (goConditions && minerFilter !== "FAIL") {
          newState = minerFilter === "PASS" ? "GO" : "GO_SPECULATIVE";
          
          // Score calculation
          const flowStrength = avgFlow3m > 0 ? Math.min(flow3m / avgFlow3m, 3) / 3 : 0;
          const buysStrength = avgBuys3m > 0 ? Math.min(buys3m / avgBuys3m, 3) / 3 : 0;
          const priceCompression = Math.max(0, 1 - Math.abs(priceChange6m) / 5);
          const liqStability = Math.max(0, Math.min(1, (liqChange6m + 10) / 20));

          score = Math.round(
            flowStrength * 50 +
            buysStrength * 25 +
            priceCompression * 15 +
            liqStability * 10
          );
          score = Math.max(0, Math.min(100, score));

          reasons = [
            `Flow ${(flow3m / (avgFlow3m || 1)).toFixed(1)}x avg`,
            `Buys ${(buys3m / (avgBuys3m || 1)).toFixed(1)}x avg`,
            `Price ${priceChange6m > 0 ? "+" : ""}${priceChange6m.toFixed(1)}%`,
          ];

          // Cooldown: 12min
          const lastNotif = existingSignal?.last_notified_at;
          const canGo = !lastNotif || (now.getTime() - new Date(lastNotif).getTime() > 12 * 60000);
          if (canGo) {
            eventType = newState;
            severity = 2;
          }
        } else if (goConditions && minerFilter === "FAIL") {
          newState = "WATCH";
          reasons = ["GO conditions met", "Miner filter FAIL"];
          score = 30;
        } else {
          // Partial or no conditions
          const partial = (avgFlow3m > 0 && flow3m > avgFlow3m) || (avgBuys3m > 0 && buys3m > avgBuys3m);
          if (partial && !isActive) {
            newState = "WATCH";
            reasons = ["Partial flow/buys signal"];
            score = 20;
          } else if (!isActive) {
            newState = "NO";
            reasons = [];
            score = 0;
          }
        }
      }

      // === E) DEPEG Detection ===
      const price1h = snap1h?.price || priceNow;
      const priceChange1h = price1h > 0 ? ((priceNow - price1h) / price1h) * 100 : 0;
      const liq1h = snap1h?.liquidity || liqNow;
      const liqChange1h = liq1h > 0 ? ((liqNow - liq1h) / liq1h) * 100 : 0;

      const depegWarning = priceChange5m <= -6 || priceChange1h <= -12;
      const depegCritical = depegWarning && (liqChange1h <= -15);

      if (depegCritical) {
        await sb.from("events").insert({
          netuid, ts: nowIso, type: "DEPEG_CRITICAL", severity: 4,
          evidence: { priceChange5m, priceChange1h, liqChange1h },
        });
      } else if (depegWarning) {
        await sb.from("events").insert({
          netuid, ts: nowIso, type: "DEPEG_WARNING", severity: 3,
          evidence: { priceChange5m, priceChange1h },
        });
      }

      // === Upsert signal ===
      const signalData: any = {
        netuid,
        ts: nowIso,
        state: newState,
        score,
        reasons,
        miner_filter: minerFilter,
      };

      if (newState !== prevState) {
        signalData.last_state_change_at = nowIso;
      }
      if (eventType) {
        signalData.last_notified_at = nowIso;
      }

      await sb.from("signals").upsert(signalData, { onConflict: "netuid" });

      // Insert event if triggered
      if (eventType) {
        await sb.from("events").insert({
          netuid,
          ts: nowIso,
          type: eventType,
          severity,
          evidence: {
            score,
            reasons,
            minerFilter,
            flow3m,
            avgFlow3m,
            buys3m,
            avgBuys3m,
            priceChange6m,
            liqChange6m,
            priceChange15m,
            priceChange30m,
          },
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
