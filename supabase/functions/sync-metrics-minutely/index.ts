import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAO = 1e9;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const headers = { Authorization: apiKey, Accept: "application/json" };

    const [poolRes, subnetRes] = await Promise.all([
      fetch("https://api.taostats.io/api/dtao/pool/latest/v1?limit=200", { headers }),
      fetch("https://api.taostats.io/api/subnet/latest/v1", { headers }),
    ]);
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
          registrations: chain.registrations ?? chain.neuron_registrations_this_interval,
          active_uids: chain.active_miners ?? chain.active_uids,
          max_n: chain.max_n ?? chain.max_uids,
          total_neurons: chain.total_neurons,
          total_stake: chain.total_stake,
          alpha_staked: chain.alpha_staked,
          validator_weight: chain.validator_weight,
          miner_weight: chain.miner_weight,
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
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Done: ${pools.length} pools, ${rows.length} inserted (batched)`);
    return new Response(JSON.stringify({ ok: true, pools: pools.length, inserted: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-metrics error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
