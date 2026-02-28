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
    const offset = Number(url.searchParams.get("offset") || "0");
    const chunkSize = Number(url.searchParams.get("chunk") || "20");

    const since = new Date(Date.now() - 31 * 86400_000).toISOString();

    const poolRes = await fetch("https://api.taostats.io/api/dtao/pool/latest/v1?limit=200", { headers });
    if (!poolRes.ok) throw new Error(`Taostats pools error: ${poolRes.status}`);
    const poolJson = await poolRes.json();
    const allNetuids = (poolJson.data || []).map((p: any) => Number(p.netuid)).filter((n: number) => !isNaN(n) && n > 0).sort((a: number, b: number) => a - b);

    const netuids = allNetuids.slice(offset, offset + chunkSize);
    console.log(`Backfilling chunk offset=${offset} size=${netuids.length}/${allNetuids.length}`);

    let totalInserted = 0;
    const errors: string[] = [];

    // Sequential to respect rate limits
    for (const netuid of netuids) {
      try {
        const histUrl = `https://api.taostats.io/api/dtao/pool/history/v1?netuid=${netuid}&start_date=${since}&limit=1000`;
        const res = await fetch(histUrl, { headers });
        if (!res.ok) {
          const text = await res.text();
          errors.push(`SN-${netuid}: HTTP ${res.status}`);
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

        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        errors.push(`SN-${netuid}: ${String(e)}`);
      }
    }

    const hasMore = offset + chunkSize < allNetuids.length;
    console.log(`Chunk done: ${totalInserted} rows, ${errors.length} errors, hasMore=${hasMore}`);
    return new Response(JSON.stringify({
      ok: true, inserted: totalInserted, processed: netuids.length, total: allNetuids.length,
      hasMore, nextOffset: hasMore ? offset + chunkSize : null,
      errors: errors.slice(0, 10),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("backfill-price-daily error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
