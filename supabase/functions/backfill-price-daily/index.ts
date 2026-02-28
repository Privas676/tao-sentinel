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

    // Fetch pool history for last 30 days — Taostats dtao/pool/history endpoint
    const since = new Date(Date.now() - 31 * 86400_000).toISOString();
    
    // Get all current pools first to know which netuids exist
    const poolRes = await fetch("https://api.taostats.io/api/dtao/pool/latest/v1?limit=200", { headers });
    if (!poolRes.ok) throw new Error(`Taostats pools error: ${poolRes.status}`);
    const poolJson = await poolRes.json();
    const pools = poolJson.data || [];
    const netuids = pools.map((p: any) => Number(p.netuid)).filter((n: number) => !isNaN(n) && n > 0);

    console.log(`Backfilling ${netuids.length} subnets since ${since}`);

    let totalInserted = 0;
    const errors: string[] = [];

    // Process in batches of 10 to avoid rate limits
    for (let i = 0; i < netuids.length; i += 10) {
      const batch = netuids.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (netuid: number) => {
          try {
            // Fetch historical pool data for this subnet
            const url = `https://api.taostats.io/api/dtao/pool/history/v1?netuid=${netuid}&start_date=${since}&limit=1000`;
            const res = await fetch(url, { headers });
            if (!res.ok) {
              const text = await res.text();
              throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
            }
            const json = await res.json();
            const history = json.data || [];

            if (history.length === 0) return 0;

            // Group by date, keep last price per day (close)
            const dailyMap = new Map<string, { close: number; high: number; low: number }>();
            for (const h of history) {
              const price = Number(h.price) || 0;
              if (price <= 0) continue;
              const date = (h.timestamp || h.created_at || h.ts || "").slice(0, 10);
              if (!date || date.length !== 10) continue;

              const existing = dailyMap.get(date);
              if (!existing) {
                dailyMap.set(date, { close: price, high: price, low: price });
              } else {
                existing.close = price; // last entry = close
                if (price > existing.high) existing.high = price;
                if (price < existing.low) existing.low = price;
              }
            }

            if (dailyMap.size === 0) return 0;

            const rows = [...dailyMap.entries()].map(([date, d]) => ({
              netuid,
              date,
              price_close: d.close,
              price_high: d.high,
              price_low: d.low,
            }));

            // Upsert (on conflict netuid+date)
            const { error } = await sb.from("subnet_price_daily").upsert(rows, {
              onConflict: "netuid,date",
              ignoreDuplicates: false,
            });
            if (error) throw new Error(error.message);
            return rows.length;
          } catch (e) {
            errors.push(`SN-${netuid}: ${String(e)}`);
            return 0;
          }
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") totalInserted += r.value;
      }

      // Small delay between batches
      if (i + 10 < netuids.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`Backfill done: ${totalInserted} daily rows inserted, ${errors.length} errors`);
    return new Response(JSON.stringify({ ok: true, inserted: totalInserted, subnets: netuids.length, errors: errors.slice(0, 10) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("backfill-price-daily error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
