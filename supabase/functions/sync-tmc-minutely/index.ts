import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("TAOMARKETCAP_API_KEY");
    if (!apiKey) throw new Error("TAOMARKETCAP_API_KEY not configured");

    const headers = { Authorization: `Api-Key ${apiKey}`, Accept: "application/json" };

    // Fetch subnets table (main endpoint with price, volume, marketcap, variations)
    const tableRes = await fetch("https://api.taomarketcap.com/public/v1/subnets/table/", { headers });
    if (!tableRes.ok) {
      const body = await tableRes.text();
      throw new Error(`TMC subnets/table error ${tableRes.status}: ${body}`);
    }
    const tableJson = await tableRes.json();
    // Response can be array or { results: [...] }
    const subnets: any[] = Array.isArray(tableJson) ? tableJson : tableJson.results || tableJson.data || [];

    if (!subnets.length) {
      return new Response(JSON.stringify({ ok: true, message: "No subnets returned from TMC", inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const tsRounded = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString();

    let inserted = 0;
    let errors = 0;

    for (const s of subnets) {
      // TMC uses netuid or id field
      const netuid = Number(s.netuid ?? s.id ?? s.subnet_id);
      if (isNaN(netuid) || netuid < 0) continue;

      // Normalize fields — TMC field names may vary, handle common patterns
      const price = Number(s.price ?? s.tao_price ?? 0) || null;
      const cap = Number(s.market_cap ?? s.marketcap ?? 0) || null;
      const vol24h = Number(s.volume_24h ?? s.vol_24h ?? s.volume ?? 0) || null;
      const liquidity = Number(s.liquidity ?? 0) || null;
      const volCap = cap && vol24h ? vol24h / cap : null;

      // Chain buys if available
      const buysProxy = Number(s.chain_buys ?? s.buys_24h ?? 0) || 0;

      // Get previous snapshot for EMA smoothing
      const { data: prev } = await sb
        .from("subnet_metrics_ts")
        .select("flow_1m, flow_3m, flow_5m")
        .eq("netuid", netuid)
        .eq("source", "taomarketcap")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Use emission as flow proxy if available
      const emission = Number(s.emission ?? s.daily_emission ?? 0) || 0;
      const flowProxy = emission + buysProxy;

      const flow_1m = flowProxy;
      const flow_3m = prev?.flow_3m ? prev.flow_3m * 0.6 + flowProxy * 0.4 : flowProxy;
      const flow_5m = prev?.flow_5m ? prev.flow_5m * 0.7 + flowProxy * 0.3 : flowProxy;

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
        daily_chain_buys_1m: buysProxy,
        daily_chain_buys_3m: prev ? prev.flow_3m ?? buysProxy : buysProxy,
        daily_chain_buys_5m: prev ? prev.flow_5m ?? buysProxy : buysProxy,
        miners_active: Number(s.miners ?? s.active_miners ?? 0) || null,
        top_miners_share: null,
        source: "taomarketcap",
        raw_payload: s,
      });

      if (error) { console.error(`TMC insert netuid ${netuid}:`, error.message); errors++; }
      else inserted++;
    }

    console.log(`TMC sync done: ${subnets.length} subnets, ${inserted} inserted, ${errors} errors`);
    return new Response(JSON.stringify({ ok: true, subnets: subnets.length, inserted, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-tmc error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
