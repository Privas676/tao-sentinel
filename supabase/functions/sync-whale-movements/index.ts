import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAO = 1e9;
const MIN_TAO = 100; // alert threshold

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

    for (const ck of coldkeys) {
      try {
        const url = `https://api.taostats.io/api/transfer/v1?address=${ck.address}&amount_min=${minRao}&timestamp_start=${since}&order=timestamp_desc&limit=50`;
        const res = await fetch(url, { headers });
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

          // Insert movement (skip duplicates via tx_hash unique constraint)
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
            if (insertErr.code === "23505") continue; // duplicate
            console.error(`Insert movement error:`, insertErr);
            continue;
          }

          totalInserted++;

          // Create an event for the alerts page
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
        console.error(`Error processing ${ck.address}:`, e);
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
