import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAO = 1e9;

async function logApiCall(sb: any, endpoint: string, opts: {
  statusCode?: number; rateLimited?: boolean; responseMs?: number; error?: string; metadata?: any;
}) {
  try {
    await sb.from("api_call_log").insert({
      function_name: "sync-metrics-minutely", endpoint,
      status_code: opts.statusCode ?? null, cached: false, deduplicated: false,
      rate_limited: opts.rateLimited ?? false, response_ms: opts.responseMs ?? null,
      error_message: opts.error ?? null, metadata: opts.metadata ?? {},
    });
  } catch { /* non-blocking */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const headers = { Authorization: apiKey, Accept: "application/json" };

    const t0 = Date.now();
    const [poolRes, subnetRes] = await Promise.all([
      fetch("https://api.taostats.io/api/dtao/pool/latest/v1?limit=200", { headers }),
      fetch("https://api.taostats.io/api/subnet/latest/v1", { headers }),
    ]);
    const apiMs = Date.now() - t0;

    // Log API calls
    await Promise.all([
      logApiCall(sb, "dtao/pool/latest/v1", { statusCode: poolRes.status, rateLimited: poolRes.status === 429, responseMs: apiMs }),
      logApiCall(sb, "subnet/latest/v1", { statusCode: subnetRes.status, rateLimited: subnetRes.status === 429, responseMs: apiMs }),
    ]);

    // Graceful degradation on rate limit — fallback to TaoFlute for immunity/subnet_limit
    if (poolRes.status === 429 || subnetRes.status === 429) {
      console.warn(`[sync-metrics] Rate-limited (pool=${poolRes.status}, subnet=${subnetRes.status}). Trying TaoFlute fallback.`);
      if (!poolRes.ok) await poolRes.text();
      if (!subnetRes.ok) await subnetRes.text();

      let taofluteFallbackCount = 0;
      try {
        // Use already-scraped TaoFlute data from external_taoflute_metrics table
        const { data: tfMetrics } = await sb
          .from("external_taoflute_metrics")
          .select("netuid, raw_data")
          .eq("is_stale", false)
          .order("scraped_at", { ascending: false })
          .limit(500);

        // Dedupe to latest per netuid
        const tfMap = new Map<number, Record<string, any>>();
        for (const r of (tfMetrics || [])) {
          if (!tfMap.has(r.netuid) && r.raw_data) tfMap.set(r.netuid, r.raw_data);
        }

        console.log(`[fallback] TaoFlute DB: ${tfMap.size} subnets with raw_data`);

        await logApiCall(sb, "taoflute/db/fallback", {
          statusCode: tfMap.size > 0 ? 200 : 0,
          responseMs: Date.now() - t0,
          metadata: { subnets: tfMap.size, reason: "taostats_429_fallback" },
        });

        if (tfMap.size > 0) {

          // Fetch latest rows from subnet_metrics_ts and enrich with TaoFlute immunity data
          const { data: latestRows } = await sb
            .from("subnet_metrics_ts")
            .select("netuid, raw_payload")
            .order("ts", { ascending: false })
            .limit(500);

          // Dedupe to latest per netuid
          const latestMap = new Map<number, any>();
          for (const r of (latestRows || [])) {
            if (!latestMap.has(r.netuid)) latestMap.set(r.netuid, r);
          }

          const now = new Date();
          const tsRounded = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString();
          const enrichedRows: any[] = [];

          for (const [netuid, existing] of latestMap) {
            const tf = tfMap.get(netuid);
            if (!tf) continue;

            const payload = existing.raw_payload || {};
            const chain = payload._chain || {};

            // Enrich with TaoFlute immunity/dereg data from raw_data
            // Derive subnet_limit from total TaoFlute subnets count
            const derivedSubnetLimit = tfMap.size > 50 ? tfMap.size : null;

            const enrichedChain = {
              ...chain,
              immunity_period: tf.immunity_period ?? tf.immunity ?? chain.immunity_period ?? null,
              passed_immunity: tf.passed_immunity ?? chain.passed_immunity ?? null,
              tempo: tf.tempo ?? chain.tempo ?? null,
              subnet_limit: tf.subnet_limit ?? tf.max_subnets ?? chain.subnet_limit ?? derivedSubnetLimit,
              rank: tf.dereg_place ?? tf.rank ?? chain.rank ?? null,
              dereg_place_one_week_out: tf.dereg_place_one_week_out ?? null,
              _fallback_source: "taoflute_db",
            };

            enrichedRows.push({
              netuid,
              ts: tsRounded,
              price: existing.raw_payload?.price ? Number(existing.raw_payload.price) : null,
              cap: existing.raw_payload?.market_cap ? Number(existing.raw_payload.market_cap) / RAO : null,
              source: "taoflute_fallback",
              raw_payload: { ...payload, _chain: enrichedChain },
            });
          }

          if (enrichedRows.length > 0) {
            const { error } = await sb.from("subnet_metrics_ts").insert(enrichedRows);
            if (!error) taofluteFallbackCount = enrichedRows.length;
            else console.error("TaoFlute fallback insert error:", error.message);
          }
        }
      } catch (e: any) {
        console.warn(`TaoFlute fallback failed: ${e.message}`);
      }

      return new Response(JSON.stringify({
        ok: taofluteFallbackCount > 0, rate_limited: true,
        fallback: "taoflute", fallback_enriched: taofluteFallbackCount,
        message: taofluteFallbackCount > 0
          ? `Taostats rate-limited, enriched ${taofluteFallbackCount} subnets via TaoFlute fallback`
          : "Taostats rate-limited, TaoFlute fallback also empty — serving stale data",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!poolRes.ok) throw new Error(`Taostats pools error: ${poolRes.status}`);
    if (!subnetRes.ok) throw new Error(`Taostats subnet error: ${subnetRes.status}`);

    const poolJson = await poolRes.json();
    const pools = poolJson.data || [];
    const subnetJson = await subnetRes.json();
    const subnets = Array.isArray(subnetJson) ? subnetJson : subnetJson.data || [];

    const chainMap = new Map<number, any>();
    for (const s of subnets) {
      const nid = Number(s.netuid);
      if (!isNaN(nid)) chainMap.set(nid, s);
    }

    // Batch fetch previous snapshots for all netuids
    const netuidList = pools.map((p: any) => Number(p.netuid)).filter((n: number) => !isNaN(n));
    const { data: prevRows } = await sb
      .from("subnet_metrics_ts")
      .select("netuid, flow_1m, flow_3m, flow_5m, flow_6m, flow_15m, daily_chain_buys_1m, daily_chain_buys_3m, daily_chain_buys_5m")
      .in("netuid", netuidList)
      .order("ts", { ascending: false })
      .limit(500);

    // Dedupe to latest per netuid
    const prevMap = new Map<number, any>();
    for (const r of (prevRows || [])) {
      if (!prevMap.has(r.netuid)) prevMap.set(r.netuid, r);
    }

    const now = new Date();
    const tsRounded = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString();

    const rows: any[] = [];

    for (const p of pools) {
      const netuid = Number(p.netuid);
      if (isNaN(netuid)) continue;

      const chain = chainMap.get(netuid);
      const prev = prevMap.get(netuid);

      const price = Number(p.price) || null;
      const cap = p.market_cap ? Number(p.market_cap) / RAO : null;
      const liquidity = p.liquidity ? Number(p.liquidity) / RAO : null;
      const vol24hRaw = p.tao_volume_24_hr || p.alpha_volume_24_hr;
      const vol24h = vol24hRaw ? Number(vol24hRaw) / RAO : null;
      const volCap = cap && vol24h ? vol24h / cap : null;

      const minersActive = chain ? (Number(chain.active_miners ?? 0) || null) : null;
      const topMinersShare = chain ? (Number(chain.top_miners_share ?? 0) || null) : null;

      const emission = chain ? (Number(chain.emission ?? 0) || 0) : 0;
      const registration = chain ? (Number(chain.registrations ?? chain.neuron_registrations_this_interval ?? 0) || 0) : 0;
      const flowProxy = emission + registration;
      const buysProxy = Number(p.buys_24_hr ?? 0) || 0;

      // EMA smoothing
      const flow_1m = flowProxy;
      const flow_3m = prev?.flow_3m ? prev.flow_3m * 0.6 + flowProxy * 0.4 : flowProxy;
      const flow_5m = prev?.flow_5m ? prev.flow_5m * 0.7 + flowProxy * 0.3 : flowProxy;
      const flow_6m = prev?.flow_6m ? prev.flow_6m * 0.75 + flowProxy * 0.25 : flowProxy;
      const flow_15m = prev?.flow_15m ? prev.flow_15m * 0.85 + flowProxy * 0.15 : flowProxy;
      const buys_1m = buysProxy;
      const buys_3m = prev?.daily_chain_buys_3m ? prev.daily_chain_buys_3m * 0.6 + buysProxy * 0.4 : buysProxy;
      const buys_5m = prev?.daily_chain_buys_5m ? prev.daily_chain_buys_5m * 0.7 + buysProxy * 0.3 : buysProxy;

      // Merge pool + chain data into raw_payload for health engine
      const mergedPayload = {
        ...p,
        // Chain data for health engine
        _chain: chain ? {
          emission: chain.emission,
          emission_per_day: chain.emission_per_day,
          projected_emission: chain.projected_emission,
          registrations: chain.registrations ?? chain.neuron_registrations_this_interval,
          active_uids: chain.active_miners ?? chain.active_uids,
          active_keys: chain.active_keys,
          active_miners: chain.active_miners,
          active_validators: chain.active_validators,
          max_neurons: chain.max_neurons ?? chain.max_n ?? chain.max_uids,
          total_neurons: chain.total_neurons ?? chain.n,
          total_stake: chain.total_stake,
          alpha_staked: chain.alpha_staked,
          validator_weight: chain.validator_weight,
          miner_weight: chain.miner_weight,
          registration_cost: chain.registration_cost,
          neuron_registration_cost: chain.neuron_registration_cost,
          incentive_burn: chain.incentive_burn,
          recycled_24_hours: chain.recycled_24_hours,
          recycled_lifetime: chain.recycled_lifetime,
          net_flow_1_day: chain.net_flow_1_day,
          net_flow_7_days: chain.net_flow_7_days,
          net_flow_30_days: chain.net_flow_30_days,
          // Additional Taostats fields for accuracy
          max_validators: chain.max_validators,
          adjustment_interval: chain.adjustment_interval,
          serving_rate_limit: chain.serving_rate_limit,
          burn_next_interval: chain.burn_next_interval,
          recycled_for_reg: chain.recycled_for_reg,
          pow_reg_allowed: chain.pow_reg_allowed,
          reg_allowed: chain.reg_allowed,
          kappa: chain.kappa,
          bonds_moving_average: chain.bonds_moving_average,
          activity_cutoff: chain.activity_cutoff,
          weight_set_rate_limit: chain.weight_set_rate_limit,
          // Canonical dereg fields (immunity, tempo, subnet limit)
          immunity_period: chain.immunity_period ?? chain.immunity_period_blocks ?? null,
          tempo: chain.tempo ?? null,
          subnet_limit: chain.subnet_limit ?? chain.max_subnets ?? null,
          created_at_block: chain.created_at_block ?? chain.registered_at ?? null,
          last_step: chain.last_step ?? null,
          rank: chain.rank ?? null,
        } : null,
      };

      rows.push({
        netuid,
        ts: tsRounded,
        price,
        cap,
        liquidity,
        vol_24h: vol24h,
        vol_cap: volCap,
        flow_1m,
        flow_3m,
        flow_5m,
        flow_6m,
        flow_15m,
        daily_chain_buys_1m: buys_1m,
        daily_chain_buys_3m: buys_3m,
        daily_chain_buys_5m: buys_5m,
        miners_active: minersActive,
        top_miners_share: topMinersShare,
        source: "taostats",
        raw_payload: mergedPayload,
      });
    }

    // Batch insert
    const { error } = await sb.from("subnet_metrics_ts").insert(rows);
    if (error) {
      console.error("Batch insert error:", error.message);
      return new Response(JSON.stringify({ ok: false, error: "Data ingestion failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Done: ${pools.length} pools, ${rows.length} inserted (batched)`);
    return new Response(JSON.stringify({ ok: true, pools: pools.length, inserted: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-metrics error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
