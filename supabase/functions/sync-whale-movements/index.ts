import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAO = 1e9;
const MIN_TAO = 100; // alert threshold
const MAX_RETRIES = 3;
const BATCH_SIZE = 5; // concurrent requests per batch
const BATCH_DELAY_MS = 1500; // delay between batches to avoid 429

/** Fetch with exponential backoff retry on 429 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < retries) {
      await res.text(); // consume body
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 15000);
      console.log(`429 rate-limited, retry ${attempt + 1}/${retries} in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  // unreachable, but TS needs it
  return await fetch(url, options);
}

/** Sleep helper */
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

    // Get all tracked coldkeys
    const { data: coldkeys, error: ckErr } = await sb
      .from("whale_coldkeys")
      .select("address, label");
    if (ckErr) throw new Error(`Failed to fetch coldkeys: ${ckErr.message}`);
    if (!coldkeys || coldkeys.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No coldkeys to track" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look back 10 minutes
    const since = Math.floor((Date.now() - 10 * 60_000) / 1000);
    const minRao = String(MIN_TAO * RAO);

    let totalInserted = 0;
    let totalEvents = 0;

    // Process coldkeys in batches to avoid rate limiting
    for (let i = 0; i < coldkeys.length; i += BATCH_SIZE) {
      const batch = coldkeys.slice(i, i + BATCH_SIZE);
      if (i > 0) await sleep(BATCH_DELAY_MS);

      const results = await Promise.allSettled(
        batch.map(async (ck) => {
          const url = `https://api.taostats.io/api/transfer/v1?address=${ck.address}&amount_min=${minRao}&timestamp_start=${since}&order=timestamp_desc&limit=50`;
          const res = await fetchWithRetry(url, { headers });
          return { ck, res };
        })
      );

      for (const result of results) {
        if (result.status === "rejected") {
          console.error(`Batch fetch error:`, result.reason);
          continue;
        }
        const { ck, res } = result.value;

        if (!res.ok) {
          console.error(`Taostats transfer error for ${ck.address}: ${res.status}`);
          await res.text();
          continue;
        }

        const json = await res.json();
        const transfers = json.data || [];

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
      }
    }

    console.log(`Whale sync done: ${totalInserted} movements, ${totalEvents} events`);
    return new Response(
      JSON.stringify({ ok: true, movements: totalInserted, events: totalEvents }),
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
