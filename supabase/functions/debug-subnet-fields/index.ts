import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const headers = { Authorization: apiKey, Accept: "application/json" };

    // Fetch subnet/latest for SN64 to see all chain fields
    const subnetRes = await fetch("https://api.taostats.io/api/subnet/latest/v1?netuid=64", { headers });
    if (!subnetRes.ok) {
      const body = await subnetRes.text();
      throw new Error(`subnet/latest error ${subnetRes.status}: ${body}`);
    }
    const subnetJson = await subnetRes.json();
    const subnet = Array.isArray(subnetJson.data) ? subnetJson.data[0] : subnetJson.data;

    // Also fetch dtao/pool for SN64
    const poolRes = await fetch("https://api.taostats.io/api/dtao/pool/latest/v1?netuid=64", { headers });
    const poolJson = poolRes.ok ? await poolRes.json() : null;
    const pool = poolJson?.data?.[0] || poolJson?.data;

    return new Response(JSON.stringify({
      subnet_keys: subnet ? Object.keys(subnet) : [],
      subnet_sample: subnet,
      pool_keys: pool ? Object.keys(pool) : [],
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
