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

    let taoUsd: number | null = null;

    // Try Taostats price endpoint
    try {
      const res = await fetch("https://api.taostats.io/api/price/latest/v1", {
        headers: { Authorization: apiKey, Accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        const priceData = Array.isArray(json) ? json[0] : json.data?.[0] || json;
        taoUsd = Number(priceData?.price ?? priceData?.usd ?? priceData?.close ?? 0);
      }
    } catch { /* fallback below */ }

    // Fallback: CoinGecko public API
    if (!taoUsd || taoUsd <= 0) {
      try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd");
        if (res.ok) {
          const json = await res.json();
          taoUsd = json?.bittensor?.usd || null;
        }
      } catch { /* ignore */ }
    }

    if (!taoUsd || taoUsd <= 0) {
      return new Response(JSON.stringify({ error: "Could not fetch TAO/USD price" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const tsRounded = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString();

    await sb.from("fx_rates").upsert({ ts: tsRounded, tao_usd: taoUsd }, { onConflict: "ts" });

    return new Response(JSON.stringify({ ok: true, tao_usd: taoUsd }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-fx error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
