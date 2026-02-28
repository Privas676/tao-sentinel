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
    const headers = { Authorization: apiKey, Accept: "application/json" };

    const url = new URL(req.url);
    const since = new Date(Date.now() - 31 * 86400_000).toISOString();

    // Get netuids that still need backfilling from DB (those with < 10 days of data in last 30d)
    const { data: coveredRows } = await sb
      .from("subnet_price_daily")
      .select("netuid")
      .gte("date", new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10));
    
    const coverageCount = new Map<number, number>();
    for (const r of coveredRows || []) {
      coverageCount.set(r.netuid, (coverageCount.get(r.netuid) || 0) + 1);
    }

    // Get all known netuids from subnets table
    const { data: allSubnets } = await sb.from("subnets").select("netuid").order("netuid");
    const allNetuids = (allSubnets || []).map(s => s.netuid);
    
    // Filter to netuids needing backfill (< 15 days coverage)
    const needsBackfill = allNetuids.filter(n => (coverageCount.get(n) || 0) < 15);
    
    const chunkSize = Number(url.searchParams.get("chunk") || "4");
    const chunk = needsBackfill.slice(0, chunkSize);

    if (chunk.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "All subnets fully backfilled", total: allNetuids.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Backfilling ${chunk.length} subnets needing data: ${chunk.join(",")}`);

    let totalInserted = 0;
    const errors: string[] = [];

    for (const netuid of chunk) {
      try {
        const histUrl = `https://api.taostats.io/api/dtao/pool/history/v1?netuid=${netuid}&start_date=${since}&limit=1000`;
        const res = await fetch(histUrl, { headers });
        if (!res.ok) {
          const text = await res.text();
          errors.push(`SN-${netuid}: HTTP ${res.status}`);
          if (res.status === 429) {
            // Stop immediately on rate limit, don't waste more requests
            break;
          }
          continue;
        }
        const json = await res.json();
        const history = json.data || [];
        if (history.length === 0) continue;

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
            existing.close = price;
            if (price > existing.high) existing.high = price;
            if (price < existing.low) existing.low = price;
          }
        }
        if (dailyMap.size === 0) continue;

        const rows = [...dailyMap.entries()].map(([date, d]) => ({
          netuid, date, price_close: d.close, price_high: d.high, price_low: d.low,
        }));

        const { error } = await sb.from("subnet_price_daily").upsert(rows, {
          onConflict: "netuid,date", ignoreDuplicates: false,
        });
        if (error) errors.push(`SN-${netuid}: ${error.message}`);
        else totalInserted += rows.length;

        await new Promise(r => setTimeout(r, 2500));
      } catch (e) {
        errors.push(`SN-${netuid}: ${String(e)}`);
      }
    }

    const remaining = needsBackfill.length - chunk.length;
    return new Response(JSON.stringify({
      ok: true, inserted: totalInserted, processed: chunk.join(","),
      remaining, errors: errors.slice(0, 10),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("backfill-price-daily error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
