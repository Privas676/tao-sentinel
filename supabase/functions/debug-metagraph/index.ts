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

    const url = `https://api.taostats.io/api/metagraph/latest/v1?netuid=1`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: res.status, body: text }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();
    const data = json.data || json;
    const isArr = Array.isArray(data);
    
    // Get first 2 neurons with ALL their keys and stake-related values
    const samples = (isArr ? data : [data]).slice(0, 2).map((n: any) => {
      const allKeys = Object.keys(n);
      const stakeRelated: Record<string, any> = {};
      for (const k of allKeys) {
        if (k.toLowerCase().includes("stake") || k.toLowerCase().includes("weight") || k.toLowerCase().includes("alpha") || k.toLowerCase().includes("tao")) {
          stakeRelated[k] = n[k];
        }
      }
      return {
        allKeys,
        coldkey: n.coldkey,
        hotkey: typeof n.hotkey,
        is_validator: n.is_validator,
        validator_permit: n.validator_permit,
        stake: n.stake,
        total_stake: n.total_stake,
        stakeRelated,
      };
    });

    return new Response(
      JSON.stringify({ isArray: isArr, totalNeurons: isArr ? data.length : 1, samples, topLevelKeys: !isArr ? Object.keys(data).slice(0, 20) : [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
