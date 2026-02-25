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

    // Fetch subnet list from Taostats
    const res = await fetch("https://api.taostats.io/api/subnet/latest/v1", {
      headers: { Authorization: apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Taostats API error: ${res.status}`);
    const json = await res.json();
    const subnets = Array.isArray(json) ? json : json.data || json.subnets || [];

    // Fetch subnet identities (names) from separate endpoint
    const nameMap: Record<number, string> = {};
    try {
      const idRes = await fetch("https://api.taostats.io/api/subnet/identity/v1", {
        headers: { Authorization: apiKey, Accept: "application/json" },
      });
      if (idRes.ok) {
        const idJson = await idRes.json();
        const identities = Array.isArray(idJson) ? idJson : idJson.data || [];
        for (const identity of identities) {
          const nid = Number(identity.netuid);
          if (!isNaN(nid) && identity.subnet_name) {
            nameMap[nid] = identity.subnet_name;
          }
        }
        console.log(`Loaded ${Object.keys(nameMap).length} subnet names from identity API`);
      } else {
        console.warn("Identity API returned status:", idRes.status);
        await idRes.text(); // consume body
      }
    } catch (e) {
      console.warn("Failed to fetch subnet identities:", e);
    }

    // Get existing netuids
    const { data: existing } = await sb.from("subnets").select("netuid");
    const existingSet = new Set((existing || []).map((s: any) => s.netuid));

    const now = new Date().toISOString();

    let updated = 0;
    let errors = 0;
    for (const s of subnets) {
      const netuid = Number(s.netuid ?? s.subnet_id ?? s.id);
      if (isNaN(netuid)) continue;

      const name = nameMap[netuid] || null;
      const isNew = !existingSet.has(netuid);

      if (isNew) {
        const { error } = await sb.from("subnets").insert({
          netuid,
          name,
          first_seen_at: now,
          last_seen_at: now,
        });
        if (error) { console.error(`Insert subnet ${netuid} error:`, error); errors++; }
        await sb.from("events").insert({
          netuid,
          ts: now,
          type: "CREATED",
          severity: 1,
          evidence: { source: "taostats", raw: s },
        });
      } else {
        const { error, count } = await sb.from("subnets").update({
          name,
          last_seen_at: now,
        }).eq("netuid", netuid);
        if (error) { console.error(`Update subnet ${netuid} error:`, error); errors++; }
        else { updated++; }
      }
    }

    console.log(`Done: ${subnets.length} subnets, ${updated} updated, ${errors} errors, ${Object.keys(nameMap).length} names`);
    return new Response(JSON.stringify({ ok: true, count: subnets.length, updated, errors, names: Object.keys(nameMap).length }), {
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
