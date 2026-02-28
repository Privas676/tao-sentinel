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
  const min = sigmoid(0, steepness, 0.5);
  const max = sigmoid(1, steepness, 0.5);
  return Math.round(((curved - min) / (max - min)) * 100);
}

function normalizeWithVariance(rawScores: number[], steepness = 6): number[] {
  const ranks = percentileRank(rawScores);
  return ranks.map(r => applySCurve(r, steepness));
}

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

    // ============= DATA DIVERGENCE DETECTION =============
    // Compare latest Taostats vs TMC metrics per subnet
    const { data: taostatsRows } = await sb.from("subnet_metrics_ts")
      .select("netuid, price, cap, vol_24h, ts")
      .eq("source", "taostats")
      .order("ts", { ascending: false }).limit(200);
    const { data: tmcRows } = await sb.from("subnet_metrics_ts")
      .select("netuid, price, cap, vol_24h, ts")
      .eq("source", "taomarketcap")
      .order("ts", { ascending: false }).limit(200);

    // Dedupe to latest per netuid
    const dedupe = (rows: any[]) => {
      const m = new Map<number, any>();
      for (const r of rows) { if (!m.has(r.netuid)) m.set(r.netuid, r); }
      return m;
    };
    const tsMap = dedupe(taostatsRows || []);
    const tmcMap = dedupe(tmcRows || []);

    const pctDiff = (a: number, b: number) => {
      const avg = (Math.abs(a) + Math.abs(b)) / 2;
      return avg > 0 ? Math.abs(a - b) / avg * 100 : 0;
    };

    // Batch dedup check
    const ago30m = new Date(now.getTime() - 30 * 60000).toISOString();
    const { data: recentDivEvents } = await sb.from("events")
      .select("netuid").eq("type", "DATA_DIVERGENCE").gte("ts", ago30m);
    const recentDivNetuids = new Set((recentDivEvents || []).map((e: any) => e.netuid));

    const divInserts: any[] = [];
    for (const [netuid, ts] of tsMap) {
      if (recentDivNetuids.has(netuid)) continue;
      const tmc = tmcMap.get(netuid);
      if (!tmc) continue;
      const fields = [
        { name: "price", a: Number(ts.price) || 0, b: Number(tmc.price) || 0 },
        { name: "cap", a: Number(ts.cap) || 0, b: Number(tmc.cap) || 0 },
        { name: "vol_24h", a: Number(ts.vol_24h) || 0, b: Number(tmc.vol_24h) || 0 },
      ];
      const divergent = fields.filter(f => f.a > 0 && f.b > 0 && pctDiff(f.a, f.b) > 8);
      if (divergent.length > 0) {
        divInserts.push({
          netuid, ts: nowIso, type: "DATA_DIVERGENCE", severity: 2,
          evidence: {
            divergences: divergent.map(f => ({
              field: f.name, taostats: Math.round(f.a * 1e6) / 1e6,
              taomarketcap: Math.round(f.b * 1e6) / 1e6,
              pct_diff: Math.round(pctDiff(f.a, f.b) * 10) / 10,
            })),
            sources: { taostats_ts: ts.ts, tmc_ts: tmc.ts },
          },
        });
      }
    }
    if (divInserts.length > 0) {
      const { error: divErr } = await sb.from("events").insert(divInserts);
      if (divErr) console.error("DATA_DIVERGENCE insert error:", divErr.message);
      else console.log(`Inserted ${divInserts.length} DATA_DIVERGENCE alerts`);
    }

    // ============= PASS 1: Collect raw metrics for all subnets =============
    type SubnetRaw = {
      netuid: number; mpiRaw: number; M: number; A: number; L: number; B: number; Q: number;
      gatingFail: boolean; breakReasons: string[]; breakout: boolean;
      priceNow: number; price5m: number; price1h: number;
      liqNow: number; liq1h: number; minersNow: number; minersDelta: number;
      priceMax7d: number; confidenceRaw: number;
      cap: number; volCap: number; liqRatio: number;
    };
    const subnetRaws: SubnetRaw[] = [];

    for (const { netuid } of subnets) {
      const { data: latest } = await sb.from("subnet_metrics_ts").select("*")
        .eq("netuid", netuid).order("ts", { ascending: false }).limit(1).maybeSingle();
      if (!latest) continue;

      const { data: snap5m } = await sb.from("subnet_metrics_ts").select("price, liquidity, miners_active")
        .eq("netuid", netuid).lte("ts", ago5m).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: snap1h } = await sb.from("subnet_metrics_ts").select("price, liquidity, miners_active")
        .eq("netuid", netuid).lte("ts", ago1h).order("ts", { ascending: false }).limit(1).maybeSingle();
      const { data: prices7d } = await sb.from("subnet_metrics_ts").select("price")
        .eq("netuid", netuid).gte("ts", ago7d).order("ts", { ascending: true });

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

      // ── Quality from REAL data: miners diversity, liquidity depth, vol/cap health ──
      let Q = 50; // base
      // Miner diversity (more miners = higher quality)
      if (minersNow >= 100) Q += 15;
      else if (minersNow >= 30) Q += 10;
      else if (minersNow >= 10) Q += 5;
      else if (minersNow <= 2) Q -= 15;
      // Liquidity depth ratio (liq/cap)
      if (liqRatio > 0.5) Q += 12;
      else if (liqRatio > 0.2) Q += 6;
      else if (liqRatio < 0.05) Q -= 10;
      // Volume/Cap ratio: healthy trading
      if (volCap > 0.1) Q += 8;
      else if (volCap > 0.02) Q += 4;
      else if (volCap < 0.005) Q -= 8;
      // Flow activity
      if (flow1m > 0) Q += 8;
      else Q -= 5;
      // Cap size bonus (larger = more established)
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
      const priceMax7d = (prices7d || []).reduce((max, r) => Math.max(max, Number(r.price) || 0), 0);
      const breakout = priceNow > priceMax7d && priceMax7d > 0;
      const B = breakout ? 100 : 0;

      const mpiRaw = clamp(Math.round(0.30 * M + 0.20 * A + 0.15 * L + 0.15 * B + 0.20 * Q), 0, 100);

      // Raw confidence before cross-subnet normalization
      const confSignal = clamp((mpiRaw - 40) / 60, 0, 1); // wider range
      const confQuality = Q / 100;
      const confidenceRaw = Math.round(100 * (0.50 * confSignal + 0.30 * confQuality + 0.20 * clamp(liqRatio, 0, 1)));

      subnetRaws.push({
        netuid, mpiRaw, M, A, L, B, Q, gatingFail, breakReasons, breakout,
        priceNow, price5m, price1h, liqNow, liq1h, minersNow, minersDelta, priceMax7d,
        confidenceRaw, cap, volCap, liqRatio,
      });
    }

    // ============= PASS 2: Percentile + S-curve normalization =============
    const rawMpis = subnetRaws.map(s => s.mpiRaw);
    const rawQs = subnetRaws.map(s => s.Q);
    const rawConfs = subnetRaws.map(s => s.confidenceRaw);
    const normalizedMpis = normalizeWithVariance(rawMpis, 6);
    const normalizedQs = normalizeWithVariance(rawQs, 6);
    const normalizedConfs = normalizeWithVariance(rawConfs, 6);

    // Scoring stuck detection
    const mpiStdDev = (() => {
      if (rawMpis.length < 3) return 999;
      const mean = rawMpis.reduce((a, b) => a + b, 0) / rawMpis.length;
      const variance = rawMpis.reduce((a, v) => a + (v - mean) ** 2, 0) / rawMpis.length;
      return Math.sqrt(variance);
    })();
    if (mpiStdDev < 5) {
      console.warn(`SCORING_STUCK: MPI stddev=${mpiStdDev.toFixed(1)}, raw range too narrow`);
    }

    // ============= PASS 3: Decision logic + upsert with normalized scores =============
    for (let i = 0; i < subnetRaws.length; i++) {
      const s = subnetRaws[i];
      const mpi = normalizedMpis[i];
      const normQ = normalizedQs[i];
      const confidencePct = normalizedConfs[i];

      const { data: existingSignal } = await sb.from("signals").select("*")
        .eq("netuid", s.netuid).maybeSingle();
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
        reasons = ["Early momentum detected", `MPI ${mpi}`, `Quality ${normQ}`];
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

      // DEPEG Detection
      const priceChange5m = s.price5m > 0 ? ((s.priceNow - s.price5m) / s.price5m) * 100 : 0;
      const priceChange1h = s.price1h > 0 ? ((s.priceNow - s.price1h) / s.price1h) * 100 : 0;
      const liqChange1h = s.liq1h > 0 ? ((s.liqNow - s.liq1h) / s.liq1h) * 100 : 0;

      if (priceChange5m <= -6 && liqChange1h <= -15) {
        await sb.from("events").insert({ netuid: s.netuid, ts: nowIso, type: "DEPEG_CRITICAL", severity: 4, evidence: { priceChange5m, priceChange1h, liqChange1h } });
      } else if (priceChange5m <= -6 || priceChange1h <= -12) {
        await sb.from("events").insert({ netuid: s.netuid, ts: nowIso, type: "DEPEG_WARNING", severity: 3, evidence: { priceChange5m, priceChange1h } });
      }

      // Upsert signal with normalized MPI
      const signalData: any = {
        netuid: s.netuid, ts: nowIso, state: newState, score: mpi, mpi,
        confidence_pct: confidencePct, quality_score: normQ, reasons,
        miner_filter: s.minersNow > 0 ? (s.minersDelta >= 0 ? "PASS" : "WARN") : "FAIL",
      };
      if (newState !== prevState) signalData.last_state_change_at = nowIso;
      if (eventType) signalData.last_notified_at = nowIso;

      await sb.from("signals").upsert(signalData, { onConflict: "netuid" });

      if (eventType) {
        await sb.from("events").insert({
          netuid: s.netuid, ts: nowIso, type: eventType, severity,
          evidence: { mpi, mpiRaw: s.mpiRaw, confidencePct, M: Math.round(s.M), A: Math.round(s.A), L: Math.round(s.L), B: s.B, Q: normQ, reasons },
        });
      }

      // Daily price snapshot
      const today = now.toISOString().split("T")[0];
      await sb.from("subnet_price_daily").upsert(
        { netuid: s.netuid, date: today, price_close: s.priceNow, price_high: Math.max(s.priceNow, s.priceMax7d || 0), price_low: s.priceNow },
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
