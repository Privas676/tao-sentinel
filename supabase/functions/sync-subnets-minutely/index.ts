import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch subnets from Taostats
    const res = await fetch("https://api.taostats.io/api/subnet/latest/v1", {
      headers: { Authorization: apiKey, Accept: "application/json" },
    });

    if (!res.ok) throw new Error(`Taostats API error: ${res.status}`);
    const json = await res.json();
    const subnets = Array.isArray(json) ? json : json.data || json.subnets || [];

    // Get existing netuids
    const { data: existing } = await sb.from("subnets").select("netuid");
    const existingSet = new Set((existing || []).map((s: any) => s.netuid));

    const now = new Date().toISOString();

    for (const s of subnets) {
      const netuid = Number(s.netuid ?? s.subnet_id ?? s.id);
      if (isNaN(netuid)) continue;

      const name = s.name || s.subnet_name || null;
      const isNew = !existingSet.has(netuid);

      await sb.from("subnets").upsert({
        netuid,
        name,
        first_seen_at: isNew ? now : undefined,
        last_seen_at: now,
      }, { onConflict: "netuid" });

      if (isNew) {
        await sb.from("events").insert({
          netuid,
          ts: now,
          type: "CREATED",
          severity: 1,
          evidence: { source: "taostats", raw: s },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, count: subnets.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-subnets error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
