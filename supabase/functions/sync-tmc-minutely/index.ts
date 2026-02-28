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

    // TMC auth: try Api-Key format first, fallback to raw key
    let headers: Record<string, string> = { Authorization: `Api-Key ${apiKey}`, Accept: "application/json" };
    let tableRes = await fetch("https://api.taomarketcap.com/public/v1/subnets/table/", { headers });
    if (tableRes.status === 401 || tableRes.status === 403) {
      console.log("Api-Key format failed, trying raw key...");
      headers = { Authorization: apiKey, Accept: "application/json" };
      tableRes = await fetch("https://api.taomarketcap.com/public/v1/subnets/table/", { headers });
    }

    if (!tableRes.ok) {
      const body = await tableRes.text();
      throw new Error(`TMC subnets/table error ${tableRes.status}: ${body}`);
    }

    const tableJson = await tableRes.json();
    const subnets: any[] = Array.isArray(tableJson) ? tableJson : tableJson.results || tableJson.data || [];

    if (!subnets.length) {
      return new Response(JSON.stringify({ ok: true, message: "No subnets from TMC", inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const tsRounded = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString();

    // Build batch rows (skip per-subnet prev lookup for speed — first sync has no prev anyway)
    const rows: any[] = [];
    for (const s of subnets) {
      const netuid = Number(s.subnet ?? s.netuid ?? s.id ?? s.subnet_id);
      if (isNaN(netuid) || netuid < 0) continue;

      const price = Number(s.price ?? 0) || null;
      const cap = Number(s.marketcap ?? s.market_cap ?? 0) || null;
      const vol24h = Number(s.volume ?? s.volume_24h ?? 0) || null;
      const liquidity = Number(s.tao_liquidity ?? s.liquidity ?? 0) || null;
      const volCap = cap && vol24h ? vol24h / cap : null;
      const buysProxy = Number(s.chain_buys_per_block ?? 0) || 0;
      const emission = Number(s.emission ?? 0) || 0;
      const flowProxy = emission + buysProxy;

      rows.push({
        netuid,
        ts: tsRounded,
        price,
        cap,
        liquidity,
        vol_24h: vol24h,
        vol_cap: volCap,
        flow_1m: flowProxy,
        flow_3m: flowProxy,
        flow_5m: flowProxy,
        daily_chain_buys_1m: buysProxy,
        daily_chain_buys_3m: buysProxy,
        daily_chain_buys_5m: buysProxy,
        miners_active: null,
        top_miners_share: null,
        source: "taomarketcap",
        raw_payload: s,
      });
    }

    // Batch insert
    const { error, count } = await sb.from("subnet_metrics_ts").insert(rows);
    if (error) {
      console.error("TMC batch insert error:", error.message);
      return new Response(JSON.stringify({ ok: false, error: error.message, attempted: rows.length }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`TMC sync done: ${subnets.length} subnets, ${rows.length} inserted`);
    return new Response(JSON.stringify({ ok: true, subnets: subnets.length, inserted: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-tmc error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
