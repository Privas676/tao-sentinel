import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;

    const res = await fetch("https://api.taostats.io/api/subnet/latest/v1", {
      headers: { Authorization: apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Taostats error: ${res.status}`);
    const json = await res.json();
    const subnets = Array.isArray(json) ? json : json.data || json.subnets || [];

    const now = new Date();
    const tsRounded = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString();

    let inserted = 0;
    for (const s of subnets) {
      const netuid = Number(s.netuid ?? s.subnet_id ?? s.id);
      if (isNaN(netuid)) continue;

      // Get previous snapshot for delta computation
      const { data: prev } = await sb
        .from("subnet_metrics_ts")
        .select("flow_1m, flow_3m, flow_5m, daily_chain_buys_1m, daily_chain_buys_3m, daily_chain_buys_5m")
        .eq("netuid", netuid)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      const price = Number(s.price ?? s.token_price ?? 0) || null;
      const cap = Number(s.market_cap ?? s.cap ?? s.mcap ?? 0) || null;
      const liquidity = Number(s.liquidity ?? s.total_liquidity ?? 0) || null;
      const vol24h = Number(s.volume_24h ?? s.vol_24h ?? s.volume ?? 0) || null;
      const volCap = cap && vol24h ? vol24h / cap : null;
      const minersActive = Number(s.active_miners ?? s.miners_active ?? s.miners ?? 0) || null;
      const topMinersShare = Number(s.top_miners_share ?? s.miner_concentration ?? 0) || null;

      // Compute flow/buys as deltas from available fields
      const emission = Number(s.emission ?? s.daily_emission ?? 0) || 0;
      const registration = Number(s.registrations ?? s.daily_registrations ?? 0) || 0;
      const flowProxy = emission + registration;

      const buysProxy = Number(s.daily_chain_buys ?? s.buys ?? 0) || 0;

      // Use exponential moving approximation for windows
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
        raw_payload: s,
      });

      if (!error) inserted++;
    }

    return new Response(JSON.stringify({ ok: true, inserted }), {
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
