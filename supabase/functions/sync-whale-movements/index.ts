import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAO = 1e9;
const MIN_TAO = 100;
const MAX_RETRIES = 3;
const KEYS_PER_RUN = 5; // process 5 coldkeys per invocation (round-robin)
const REQUEST_DELAY_MS = 3000; // 3s between requests

/** Fetch with exponential backoff retry on 429 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < retries) {
      await res.text();
      const retryAfter = res.headers.get("retry-after");
      const delay = retryAfter
        ? Number(retryAfter) * 1000
        : Math.min(2000 * Math.pow(2, attempt) + Math.random() * 1000, 20000);
      console.log(`429 rate-limited, retry ${attempt + 1}/${retries} in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  return await fetch(url, options);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const headers = { Authorization: apiKey, Accept: "application/json" };

    // Get all tracked coldkeys ordered by id for stable round-robin
    const { data: coldkeys, error: ckErr } = await sb
      .from("whale_coldkeys")
      .select("id, address, label")
      .order("id", { ascending: true });
    if (ckErr) throw new Error(`Failed to fetch coldkeys: ${ckErr.message}`);
    if (!coldkeys || coldkeys.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No coldkeys to track" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Round-robin: use minute-of-hour to pick a rotating slice
    const minuteOfHour = new Date().getMinutes();
    const totalSlices = Math.ceil(coldkeys.length / KEYS_PER_RUN);
    const sliceIndex = Math.floor(minuteOfHour / 15) % totalSlices; // changes every 15min
    const start = sliceIndex * KEYS_PER_RUN;
    const batch = coldkeys.slice(start, start + KEYS_PER_RUN);

    console.log(`Processing slice ${sliceIndex + 1}/${totalSlices}: ${batch.length} coldkeys (ids ${batch.map(c => c.id).join(",")})`);

    // Look back 90 minutes to cover full rotation (5 slices × 15min + margin)
    const since = Math.floor((Date.now() - 90 * 60_000) / 1000);
    const minRao = String(MIN_TAO * RAO);

    let totalInserted = 0;
    let totalEvents = 0;

    for (let i = 0; i < batch.length; i++) {
      const ck = batch[i];
      if (i > 0) await sleep(REQUEST_DELAY_MS);

      try {
        const url = `https://api.taostats.io/api/transfer/v1?address=${ck.address}&amount_min=${minRao}&timestamp_start=${since}&order=timestamp_desc&limit=50`;
        const res = await fetchWithRetry(url, { headers });

        if (!res.ok) {
          console.error(`Taostats error ${ck.label || ck.address.slice(0, 8)}: ${res.status}`);
          await res.text();
          continue;
        }

        const json = await res.json();
        const transfers = json.data || [];
        console.log(`${ck.label || ck.address.slice(0, 8)}: ${transfers.length} transfers`);

        for (const tx of transfers) {
          const txHash = tx.extrinsic_id || tx.id || null;
          if (!txHash) continue;

          const fromAddr = tx.from?.ss58 || tx.from;
          const toAddr = tx.to?.ss58 || tx.to;
          const amountTao = Number(tx.amount) / RAO;
          const direction = fromAddr === ck.address ? "OUT" : "IN";
          const counterparty = direction === "OUT" ? toAddr : fromAddr;

          const { error: insertErr } = await sb.from("whale_movements").insert({
            coldkey_address: ck.address,
            direction,
            amount_tao: amountTao,
            counterparty,
            tx_hash: txHash,
            block_number: tx.block_number || null,
            raw_payload: tx,
          });

          if (insertErr) {
            if (insertErr.code === "23505") continue;
            console.error(`Insert movement error:`, insertErr);
            continue;
          }

          totalInserted++;

          const label = ck.label || `${ck.address.slice(0, 8)}…`;
          const { error: evErr } = await sb.from("events").insert({
            netuid: null,
            type: "WHALE_MOVE",
            severity: amountTao >= 1000 ? 3 : amountTao >= 500 ? 2 : 1,
            evidence: {
              coldkey: ck.address,
              label,
              direction,
              amount_tao: Math.round(amountTao),
              counterparty,
              tx_hash: txHash,
            },
          });

          if (evErr) console.error(`Insert event error:`, evErr);
          else totalEvents++;
        }
      } catch (e) {
        console.error(`Error processing ${ck.label || ck.address.slice(0, 8)}:`, e);
      }
    }

    console.log(`Whale sync done: ${totalInserted} movements, ${totalEvents} events (slice ${sliceIndex + 1}/${totalSlices})`);
    return new Response(
      JSON.stringify({ ok: true, movements: totalInserted, events: totalEvents, slice: sliceIndex + 1, totalSlices }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sync-whale-movements error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
