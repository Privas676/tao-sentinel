import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAO = 1e9; // 1 TAO = 1e9 rao

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const headers = { Authorization: apiKey, Accept: "application/json" };

    // Fetch dTAO pool data (price, cap, vol, liquidity)
    const poolRes = await fetch("https://api.taostats.io/api/dtao/pool/latest/v1?limit=200", { headers });
    if (!poolRes.ok) throw new Error(`Taostats pools error: ${poolRes.status}`);
    const poolJson = await poolRes.json();
    const pools = poolJson.data || [];

    // Fetch subnet chain data (emission, registrations, miners)
    const subnetRes = await fetch("https://api.taostats.io/api/subnet/latest/v1", { headers });
    if (!subnetRes.ok) throw new Error(`Taostats subnet error: ${subnetRes.status}`);
    const subnetJson = await subnetRes.json();
    const subnets = Array.isArray(subnetJson) ? subnetJson : subnetJson.data || [];

    // Build chain data lookup
    const chainMap = new Map<number, any>();
    for (const s of subnets) {
      const nid = Number(s.netuid);
      if (!isNaN(nid)) chainMap.set(nid, s);
    }

    const now = new Date();
    const tsRounded = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString();

    let inserted = 0;
    let errors = 0;

    for (const p of pools) {
      const netuid = Number(p.netuid);
      if (isNaN(netuid)) continue;

      const chain = chainMap.get(netuid);

      // Get previous snapshot for EMA smoothing
      const { data: prev } = await sb
        .from("subnet_metrics_ts")
        .select("flow_1m, flow_3m, flow_5m, daily_chain_buys_1m, daily_chain_buys_3m, daily_chain_buys_5m")
        .eq("netuid", netuid)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Pool data - price is in TAO, market_cap/liquidity are in rao
      const price = Number(p.price) || null;
      const cap = p.market_cap ? Number(p.market_cap) / RAO : null;
      const liquidity = p.liquidity ? Number(p.liquidity) / RAO : null;
      // Volume: use tao_volume_24_hr if available, else alpha_volume_24_hr
      const vol24hRaw = p.tao_volume_24_hr || p.alpha_volume_24_hr;
      const vol24h = vol24hRaw ? Number(vol24hRaw) / RAO : null;
      const volCap = cap && vol24h ? vol24h / cap : null;

      // Miners from chain data
      const minersActive = chain ? (Number(chain.active_miners ?? 0) || null) : null;
      const topMinersShare = chain ? (Number(chain.top_miners_share ?? 0) || null) : null;

      // Flow proxy from chain data
      const emission = chain ? (Number(chain.emission ?? 0) || 0) : 0;
      const registration = chain ? (Number(chain.registrations ?? chain.neuron_registrations_this_interval ?? 0) || 0) : 0;
      const flowProxy = emission + registration;

      const buysProxy = Number(p.buys_24_hr ?? 0) || 0;

      // EMA smoothing
      const flow_1m = flowProxy;
      const flow_3m = prev?.flow_3m ? prev.flow_3m * 0.6 + flowProxy * 0.4 : flowProxy;
      const flow_5m = prev?.flow_5m ? prev.flow_5m * 0.7 + flowProxy * 0.3 : flowProxy;
      const buys_1m = buysProxy;
      const buys_3m = prev?.daily_chain_buys_3m ? prev.daily_chain_buys_3m * 0.6 + buysProxy * 0.4 : buysProxy;
      const buys_5m = prev?.daily_chain_buys_5m ? prev.daily_chain_buys_5m * 0.7 + buysProxy * 0.3 : buysProxy;

      const { error } = await sb.from("subnet_metrics_ts").insert({
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
        daily_chain_buys_1m: buys_1m,
        daily_chain_buys_3m: buys_3m,
        daily_chain_buys_5m: buys_5m,
        miners_active: minersActive,
        top_miners_share: topMinersShare,
        source: "taostats",
        raw_payload: p,
      });

      if (error) { console.error(`Insert netuid ${netuid}:`, error); errors++; }
      else inserted++;
    }

    console.log(`Done: ${pools.length} pools, ${inserted} inserted, ${errors} errors`);
    return new Response(JSON.stringify({ ok: true, pools: pools.length, inserted, errors }), {
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
