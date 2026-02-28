import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function scoreClip(x: number, lo: number, hi: number) { return 100 * clamp((x - lo) / (hi - lo), 0, 1); }

/* ── Percentile + S-curve normalization ── */
function sigmoid(x: number, steepness = 10, midpoint = 0.5): number {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

function percentileRank(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 50);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map(v => {
    const below = sorted.filter(s => s < v).length;
    const equal = sorted.filter(s => s === v).length;
    return ((below + equal * 0.5) / sorted.length) * 100;
  });
}

function applySCurve(percentile: number, steepness = 6): number {
  const n = percentile / 100;
  const curved = sigmoid(n, steepness, 0.5);
  const lo = sigmoid(0, steepness, 0.5);
  const hi = sigmoid(1, steepness, 0.5);
  return Math.round(((curved - lo) / (hi - lo)) * 100);
}

function normalizeWithVariance(rawScores: number[], steepness = 6): number[] {
  return percentileRank(rawScores).map(r => applySCurve(r, steepness));
}

/* ── Helpers ── */
function dedupeLatest(rows: any[], key = "netuid"): Map<number, any> {
  const m = new Map<number, any>();
  for (const r of rows) { if (!m.has(r[key])) m.set(r[key], r); }
  return m;
}

const pctDiff = (a: number, b: number) => {
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  return avg > 0 ? Math.abs(a - b) / avg * 100 : 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date();
    const nowIso = now.toISOString();
    const ago5m = new Date(now.getTime() - 5 * 60000).toISOString();
    const ago1h = new Date(now.getTime() - 60 * 60000).toISOString();
    const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60000).toISOString();
    const ago30m = new Date(now.getTime() - 30 * 60000).toISOString();

    // ============= BATCH FETCH: All data in parallel =============
    const [
      { data: subnets },
      { data: latestRows },
      { data: snap5mRows },
      { data: snap1hRows },
      { data: prices7dRows },
      { data: existingSignals },
      { data: taostatsRows },
      { data: tmcRows },
      { data: recentDivEvents },
      { data: existingOverrides },
    ] = await Promise.all([
      sb.from("subnets").select("netuid"),
      sb.from("subnet_metrics_ts").select("netuid, price, cap, vol_24h, liquidity, miners_active, top_miners_share, flow_1m, vol_cap")
        .order("ts", { ascending: false }).limit(500),
      sb.from("subnet_metrics_ts").select("netuid, price, liquidity, miners_active, ts")
        .lte("ts", ago5m).order("ts", { ascending: false }).limit(500),
      sb.from("subnet_metrics_ts").select("netuid, price, liquidity, miners_active, ts")
        .lte("ts", ago1h).order("ts", { ascending: false }).limit(500),
      sb.from("subnet_metrics_ts").select("netuid, price")
        .gte("ts", ago7d).order("ts", { ascending: true }).limit(1000),
      sb.from("signals").select("*"),
      sb.from("subnet_metrics_ts").select("netuid, price, cap, vol_24h, ts")
        .eq("source", "taostats").order("ts", { ascending: false }).limit(200),
      sb.from("subnet_metrics_ts").select("netuid, price, cap, vol_24h, ts")
        .eq("source", "taomarketcap").order("ts", { ascending: false }).limit(200),
      sb.from("events").select("netuid").eq("type", "DATA_DIVERGENCE").gte("ts", ago30m),
      // Existing RISK_OVERRIDE events (1 per subnet max)
      sb.from("events").select("id, netuid").eq("type", "RISK_OVERRIDE"),
    ]);

    if (!subnets?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============= Build lookup maps from batch data =============
    const latestMap = dedupeLatest(latestRows || []);
    const snap5mMap = dedupeLatest(snap5mRows || []);
    const snap1hMap = dedupeLatest(snap1hRows || []);
    const signalsMap = new Map<number, any>();
    for (const sig of (existingSignals || [])) signalsMap.set(sig.netuid, sig);

    // 7d price max per subnet
    const priceMax7dMap = new Map<number, number>();
    for (const r of (prices7dRows || [])) {
      const p = Number(r.price) || 0;
      const cur = priceMax7dMap.get(r.netuid) || 0;
      if (p > cur) priceMax7dMap.set(r.netuid, p);
    }

    // ============= DATA DIVERGENCE DETECTION (tiered tolerances) =============
    const tsMap = dedupeLatest(taostatsRows || []);
    const tmcMap = dedupeLatest(tmcRows || []);
    const recentDivNetuids = new Set((recentDivEvents || []).map((e: any) => e.netuid));

    const divInserts: any[] = [];
    // Track persistent divergences for 2-cycle requirement
    const PRICE_WARN = 0.005; // 0.5%
    const PRICE_CRIT = 0.01;  // 1%
    const MC_WARN = 0.02;     // 2%
    const MC_CRIT = 0.05;     // 5%

    for (const [netuid, ts] of tsMap) {
      if (recentDivNetuids.has(netuid)) continue; // Already reported in last 30min (2-cycle persistence)
      const tmc = tmcMap.get(netuid);
      if (!tmc) continue;

      const fields = [
        { name: "price", a: Number(ts.price) || 0, b: Number(tmc.price) || 0, warnThresh: PRICE_WARN, critThresh: PRICE_CRIT },
        { name: "cap", a: Number(ts.cap) || 0, b: Number(tmc.cap) || 0, warnThresh: MC_WARN, critThresh: MC_CRIT },
        { name: "vol_24h", a: Number(ts.vol_24h) || 0, b: Number(tmc.vol_24h) || 0, warnThresh: 0.10, critThresh: 0.20 },
      ];

      let hasCritical = false;
      let hasWarning = false;
      const divergent: any[] = [];

      for (const f of fields) {
        if (f.a <= 0 || f.b <= 0) continue;
        const div = pctDiff(f.a, f.b) / 100; // as ratio
        if (div > f.critThresh) {
          hasCritical = true;
          divergent.push({ field: f.name, taostats: Math.round(f.a * 1e6) / 1e6, taomarketcap: Math.round(f.b * 1e6) / 1e6, pct_diff: Math.round(div * 1000) / 10, severity: "critical" });
        } else if (div > f.warnThresh) {
          hasWarning = true;
          divergent.push({ field: f.name, taostats: Math.round(f.a * 1e6) / 1e6, taomarketcap: Math.round(f.b * 1e6) / 1e6, pct_diff: Math.round(div * 1000) / 10, severity: "warning" });
        }
      }

      if (!hasCritical && !hasWarning) continue;

      // Compute confidence_data
      const divValues = fields.filter(f => f.a > 0 && f.b > 0).map(f => Math.abs(f.a - f.b) / ((Math.abs(f.a) + Math.abs(f.b)) / 2));
      const meanDiv = divValues.length > 0 ? divValues.reduce((a, b) => a + b, 0) / divValues.length : 0;
      const confidenceData = Math.round(100 - Math.min(meanDiv * 150, 60));

      // Only alert if Warning/Critical AND confidence < 85
      if (confidenceData >= 85) continue;

      divInserts.push({
        netuid, ts: nowIso, type: "DATA_DIVERGENCE", severity: hasCritical ? 3 : 2,
        evidence: {
          divergences: divergent,
          confidence_data: confidenceData,
          sources: { taostats_ts: ts.ts, tmc_ts: tmc.ts },
        },
      });
    }
    if (divInserts.length > 0) {
      const { error: divErr } = await sb.from("events").insert(divInserts);
      if (divErr) console.error("DATA_DIVERGENCE insert error:", divErr.message);
      else console.log(`Inserted ${divInserts.length} DATA_DIVERGENCE alerts (tiered thresholds)`);
    }

    // ============= PASS 1: Compute raw scores (no DB calls, all from maps) =============
    type SubnetRaw = {
      netuid: number; mpiRaw: number; M: number; A: number; L: number; B: number; Q: number;
      gatingFail: boolean; breakReasons: string[]; breakout: boolean;
      priceNow: number; price5m: number; price1h: number;
      liqNow: number; liq1h: number; minersNow: number; minersDelta: number;
      priceMax7d: number; confidenceRaw: number;
    };
    const subnetRaws: SubnetRaw[] = [];

    for (const { netuid } of subnets) {
      const latest = latestMap.get(netuid);
      if (!latest) continue;

      const snap5m = snap5mMap.get(netuid);
      const snap1h = snap1hMap.get(netuid);

      const priceNow = Number(latest.price) || 0;
      const price5m = Number(snap5m?.price) || priceNow;
      const price1h = Number(snap1h?.price) || priceNow;
      const minersNow = Number(latest.miners_active) || 0;
      const miners1h = Number(snap1h?.miners_active) || minersNow;
      const liqNow = Number(latest.liquidity) || 0;
      const cap = Number(latest.cap) || 0;
      const vol24h = Number(latest.vol_24h) || 0;
      const volCap = cap > 0 ? vol24h / cap : 0;
      const liqRatio = cap > 0 ? liqNow / cap : 0;
      const flow1m = Number(latest.flow_1m) || 0;

      const liq1h = Number(snap1h?.liquidity) || liqNow;
      const liqHaircut = liq1h > 0 ? ((liqNow - liq1h) / liq1h) * 100 : 0;

      const gatingFail = minersNow === 0 || liqHaircut <= -60;
      const breakReasons: string[] = [];
      if (minersNow === 0) breakReasons.push("Zero miners");
      if (liqHaircut <= -60) breakReasons.push("Liquidity collapse");

      // ── Quality from REAL data ──
      let Q = 50;
      if (minersNow >= 100) Q += 15;
      else if (minersNow >= 30) Q += 10;
      else if (minersNow >= 10) Q += 5;
      else if (minersNow <= 2) Q -= 15;
      if (liqRatio > 0.5) Q += 12;
      else if (liqRatio > 0.2) Q += 6;
      else if (liqRatio < 0.05) Q -= 10;
      if (volCap > 0.1) Q += 8;
      else if (volCap > 0.02) Q += 4;
      else if (volCap < 0.005) Q -= 8;
      if (flow1m > 0) Q += 8;
      else Q -= 5;
      if (cap > 100000) Q += 7;
      else if (cap > 10000) Q += 3;
      else if (cap < 500) Q -= 8;
      Q = clamp(Q, 0, 100);

      // ── Momentum ──
      const r5m = priceNow > 0 && price5m > 0 ? Math.log(priceNow / price5m) : 0;
      const r1h = priceNow > 0 && price1h > 0 ? Math.log(priceNow / price1h) : 0;
      const M = 0.4 * scoreClip(r1h, -0.02, 0.04) + 0.6 * scoreClip(r5m, -0.004, 0.010);
      const minersDelta = minersNow - miners1h;
      const A = scoreClip(minersDelta, -5, 25);
      const L = liqHaircut !== 0 ? 100 - scoreClip(Math.abs(liqHaircut), 0, 60) : 50;
      const priceMax7d = priceMax7dMap.get(netuid) || 0;
      const breakout = priceNow > priceMax7d && priceMax7d > 0;
      const B = breakout ? 100 : 0;

      const mpiRaw = clamp(Math.round(0.30 * M + 0.20 * A + 0.15 * L + 0.15 * B + 0.20 * Q), 0, 100);
      const confSignal = clamp((mpiRaw - 40) / 60, 0, 1);
      const confQuality = Q / 100;
      const confidenceRaw = Math.round(100 * (0.50 * confSignal + 0.30 * confQuality + 0.20 * clamp(liqRatio, 0, 1)));

      subnetRaws.push({
        netuid, mpiRaw, M, A, L, B, Q, gatingFail, breakReasons, breakout,
        priceNow, price5m, price1h, liqNow, liq1h, minersNow, minersDelta, priceMax7d, confidenceRaw,
      });
    }

    if (!subnetRaws.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============= PASS 2: Percentile + S-curve normalization =============
    const normalizedMpis = normalizeWithVariance(subnetRaws.map(s => s.mpiRaw), 6);
    const normalizedQs = normalizeWithVariance(subnetRaws.map(s => s.Q), 6);
    const normalizedConfs = normalizeWithVariance(subnetRaws.map(s => s.confidenceRaw), 6);

    const mpiStdDev = (() => {
      const vals = subnetRaws.map(s => s.mpiRaw);
      if (vals.length < 3) return 999;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
    })();
    if (mpiStdDev < 5) console.warn(`SCORING_STUCK: MPI stddev=${mpiStdDev.toFixed(1)}`);

    console.log(`Pass2: ${subnetRaws.length} subnets, MPI range [${Math.min(...normalizedMpis)}-${Math.max(...normalizedMpis)}], Q range [${Math.min(...normalizedQs)}-${Math.max(...normalizedQs)}], Conf range [${Math.min(...normalizedConfs)}-${Math.max(...normalizedConfs)}]`);

    // ============= PASS 3: Decision logic (no DB reads, batch writes) =============
    const signalUpserts: any[] = [];
    const eventInserts: any[] = [];
    const dailyUpserts: any[] = [];
    const today = now.toISOString().split("T")[0];

    for (let i = 0; i < subnetRaws.length; i++) {
      const s = subnetRaws[i];
      const mpi = normalizedMpis[i];
      const normQ = normalizedQs[i];
      const confidencePct = normalizedConfs[i];
      const existingSignal = signalsMap.get(s.netuid);
      const prevState = existingSignal?.state || "NO";

      let newState: string;
      let reasons: string[] = [];
      let eventType: string | null = null;
      let severity = 0;

      if (s.gatingFail) {
        newState = "BREAK";
        reasons = s.breakReasons;
        const canNotify = !existingSignal?.last_notified_at ||
          (now.getTime() - new Date(existingSignal.last_notified_at).getTime() > 15 * 60000);
        if (canNotify && prevState !== "BREAK") { eventType = "BREAK"; severity = 3; }
      }
      else if (mpi >= 85 && s.M >= 65 && normQ >= 60) {
        newState = "GO";
        reasons = ["High MPI", `Momentum ${Math.round(s.M)}`, `Quality ${normQ}`];
        if (s.breakout) reasons.push("7d breakout");
        reasons = reasons.slice(0, 3);
        const canGo = !existingSignal?.last_notified_at ||
          (now.getTime() - new Date(existingSignal.last_notified_at).getTime() > 30 * 60000);
        if (canGo) { eventType = "GO"; severity = 2; }
      }
      else if (mpi >= 72 && s.M >= 55 && normQ >= 55) {
        newState = "EARLY";
        reasons = ["Early momentum", `MPI ${mpi}`, `Quality ${normQ}`];
        if (s.breakout) reasons.push("Approaching breakout");
        reasons = reasons.slice(0, 3);
        const lastChange = existingSignal?.last_state_change_at;
        const cooldownOk = !lastChange || prevState !== "EARLY" ||
          (now.getTime() - new Date(lastChange).getTime() > 60 * 60000);
        if (cooldownOk) {
          const canNotify = !existingSignal?.last_notified_at ||
            (now.getTime() - new Date(existingSignal.last_notified_at).getTime() > 60 * 60000);
          if (canNotify) { eventType = "EARLY"; severity = 2; }
        } else {
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
        newState = "BREAK";
        reasons = ["Low MPI"];
      }

      // DEPEG
      const priceChange5m = s.price5m > 0 ? ((s.priceNow - s.price5m) / s.price5m) * 100 : 0;
      const priceChange1h = s.price1h > 0 ? ((s.priceNow - s.price1h) / s.price1h) * 100 : 0;
      const liqChange1h = s.liq1h > 0 ? ((s.liqNow - s.liq1h) / s.liq1h) * 100 : 0;

      if (priceChange5m <= -6 && liqChange1h <= -15) {
        eventInserts.push({ netuid: s.netuid, ts: nowIso, type: "DEPEG_CRITICAL", severity: 4, evidence: { priceChange5m, priceChange1h, liqChange1h } });
      } else if (priceChange5m <= -6 || priceChange1h <= -12) {
        eventInserts.push({ netuid: s.netuid, ts: nowIso, type: "DEPEG_WARNING", severity: 3, evidence: { priceChange5m, priceChange1h } });
      }

      // Signal upsert data
      const signalData: any = {
        netuid: s.netuid, ts: nowIso, state: newState, score: mpi, mpi,
        confidence_pct: confidencePct, quality_score: normQ, reasons,
        miner_filter: s.minersNow > 0 ? (s.minersDelta >= 0 ? "PASS" : "WARN") : "FAIL",
      };
      if (newState !== prevState) signalData.last_state_change_at = nowIso;
      if (eventType) signalData.last_notified_at = nowIso;
      signalUpserts.push(signalData);

      if (eventType) {
        eventInserts.push({
          netuid: s.netuid, ts: nowIso, type: eventType, severity,
          evidence: { mpi, mpiRaw: s.mpiRaw, confidencePct, M: Math.round(s.M), A: Math.round(s.A), L: Math.round(s.L), B: s.B, Q: normQ, reasons },
        });
      }

      dailyUpserts.push({
        netuid: s.netuid, date: today, price_close: s.priceNow,
        price_high: Math.max(s.priceNow, s.priceMax7d || 0), price_low: s.priceNow,
      });
    }

    // ============= RISK_OVERRIDE: 1 event per overridden subnet =============
    const overrideMap = new Map<number, number>(); // netuid -> event id
    for (const o of (existingOverrides || [])) {
      if (o.netuid != null) overrideMap.set(o.netuid, o.id);
    }

    const overrideInserts: any[] = [];
    const overrideUpdates: { id: number; ts: string }[] = [];
    const clearedOverrideIds: number[] = [];

    for (let i = 0; i < subnetRaws.length; i++) {
      const s = subnetRaws[i];
      const mpi = normalizedMpis[i];
      const normQ = normalizedQs[i];
      const risk = normalizedConfs[i]; // reuse normalized risk proxy
      const liqChange1h = s.liq1h > 0 ? ((s.liqNow - s.liq1h) / s.liq1h) * 100 : 0;

      // Override conditions (mirror client-side risk-override.ts)
      const isOverridden =
        s.gatingFail ||
        s.minersNow === 0 ||
        liqChange1h <= -60 ||
        mpi > 85 && normQ < 30 ||
        // State-based: BREAK from low MPI
        (mpi < 40);

      const existingId = overrideMap.get(s.netuid);

      if (isOverridden) {
        const evidence = {
          mpi, quality: normQ, risk,
          gatingFail: s.gatingFail,
          minersNow: s.minersNow,
          liqChange1h: Math.round(liqChange1h * 10) / 10,
          reasons: s.breakReasons,
        };
        if (existingId) {
          // Update timestamp only
          overrideUpdates.push({ id: existingId, ts: nowIso });
        } else {
          overrideInserts.push({
            netuid: s.netuid, ts: nowIso, type: "RISK_OVERRIDE", severity: 3, evidence,
          });
        }
      } else if (existingId) {
        // Subnet no longer overridden → clean up
        clearedOverrideIds.push(existingId);
      }
    }

    // ============= BATCH WRITES =============
    const writeResults = await Promise.all([
      signalUpserts.length > 0
        ? sb.from("signals").upsert(signalUpserts, { onConflict: "netuid" })
        : Promise.resolve({ error: null }),
      eventInserts.length > 0
        ? sb.from("events").insert(eventInserts)
        : Promise.resolve({ error: null }),
      dailyUpserts.length > 0
        ? sb.from("subnet_price_daily").upsert(dailyUpserts, { onConflict: "netuid,date" })
        : Promise.resolve({ error: null }),
      overrideInserts.length > 0
        ? sb.from("events").insert(overrideInserts)
        : Promise.resolve({ error: null }),
      ...overrideUpdates.map(u =>
        sb.from("events").update({ ts: u.ts }).eq("id", u.id)
      ),
      clearedOverrideIds.length > 0
        ? sb.from("events").delete().in("id", clearedOverrideIds)
        : Promise.resolve({ error: null }),
    ]);

    for (const r of writeResults) {
      if (r.error) console.error("Batch write error:", r.error.message);
    }

    console.log(`Done: ${subnetRaws.length} subnets processed, ${eventInserts.length} events, ${signalUpserts.length} signals, ${overrideInserts.length} new overrides, ${overrideUpdates.length} updated, ${clearedOverrideIds.length} cleared`);

    return new Response(JSON.stringify({ ok: true, processed: subnetRaws.length }), {
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
