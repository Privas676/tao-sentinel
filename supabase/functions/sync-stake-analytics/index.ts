import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAO = 1e9;
const SUBNETS_PER_RUN = 3;
const REQUEST_DELAY_MS = 4000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < retries) {
      await res.text();
      const delay = Math.min(3000 * Math.pow(2, attempt), 20000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  return await fetch(url, options);
}

function dedupeLatest(rows: any[]): Map<number, any> {
  const map = new Map<number, any>();
  for (const r of rows || []) {
    if (!map.has(r.netuid)) map.set(r.netuid, r);
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const headers = { Authorization: apiKey, Accept: "application/json" };

    // 1. Get latest metrics with full raw_payload for all subnets
    const { data: latestMetrics, error: latestErr } = await sb
      .from("subnet_latest")
      .select("netuid, raw_payload, miners_active, ts");
    if (latestErr) throw new Error(`Failed to fetch latest: ${latestErr.message}`);
    if (!latestMetrics?.length) {
      return new Response(JSON.stringify({ ok: true, message: "No data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const netuidList = latestMetrics.map((m) => m.netuid).filter(Boolean) as number[];
    const now = Date.now();
    const ts24hAgo = new Date(now - 24 * 3600_000).toISOString();
    const ts7dAgo = new Date(now - 7 * 86400_000).toISOString();

    // 2. Get historical stake analytics for delta calculations
    const [prevAnalyticsRes, hist7dRes] = await Promise.all([
      sb.from("subnet_stake_analytics")
        .select("netuid, holders_count, stake_concentration, validators_active, stake_total, miners_active")
        .in("netuid", netuidList)
        .order("ts", { ascending: false })
        .limit(500),
      sb.from("subnet_stake_analytics")
        .select("netuid, stake_total, miners_active, holders_count, validators_active")
        .in("netuid", netuidList)
        .lte("ts", ts7dAgo)
        .order("ts", { ascending: false })
        .limit(500),
    ]);
    const prevMap = dedupeLatest(prevAnalyticsRes.data || []);

    // 3. Round-robin metagraph fetch from Taostats
    const minuteOfHour = new Date().getMinutes();
    const totalSlices = Math.ceil(netuidList.length / SUBNETS_PER_RUN);
    const sliceIndex = Math.floor(minuteOfHour / 15) % totalSlices;
    const start = sliceIndex * SUBNETS_PER_RUN;
    const metagraphBatch = netuidList.slice(start, start + SUBNETS_PER_RUN);

    const metagraphData = new Map<number, any>();
    for (let i = 0; i < metagraphBatch.length; i++) {
      const nid = metagraphBatch[i];
      if (i > 0) await sleep(REQUEST_DELAY_MS);
      try {
        const url = `https://api.taostats.io/api/metagraph/latest/v1?netuid=${nid}`;
        const res = await fetchWithRetry(url, { headers });
        if (res.ok) {
          const json = await res.json();
          metagraphData.set(nid, json.data || json);
        } else {
          console.log(`Metagraph SN-${nid}: ${res.status}`);
          await res.text();
        }
      } catch (e) {
        console.error(`Metagraph error SN-${nid}:`, e);
      }
    }

    // 4. Get whale movements per subnet for last 24h
    const { data: recentWhales } = await sb
      .from("whale_movements")
      .select("direction, amount_tao, netuid")
      .gte("detected_at", ts24hAgo);

    // Per-subnet whale flows
    const whaleFlowMap = new Map<number, { inflow: number; outflow: number }>();
    for (const w of recentWhales || []) {
      const nid = w.netuid || 0;
      const entry = whaleFlowMap.get(nid) || { inflow: 0, outflow: 0 };
      if (w.direction === "IN") entry.inflow += Number(w.amount_tao);
      else entry.outflow += Number(w.amount_tao);
      whaleFlowMap.set(nid, entry);
    }
    // Also aggregate non-subnet-specific whales
    const globalWhales = whaleFlowMap.get(0) || { inflow: 0, outflow: 0 };

    // Compute total emission for emission share calculation
    let totalEmission = 0;
    for (const m of latestMetrics) {
      const chain = (m.raw_payload as any)?._chain || {};
      totalEmission += Number(chain.emission || 0);
    }

    // 5. Compute analytics for all subnets
    const rows: any[] = [];
    const tsRounded = new Date().toISOString();

    for (const m of latestMetrics) {
      const nid = m.netuid as number;
      if (!nid) continue;

      const payload = m.raw_payload as any;
      const chain = payload?._chain || {};

      // Extract real stake from raw_payload (alpha_staked is in rao)
      const alphaStaked = Number(payload?.alpha_staked || 0) / RAO;
      const totalTao = Number(payload?.total_tao || 0) / RAO;
      const stakeTotal = alphaStaked > 0 ? alphaStaked : totalTao;

      const minersActive = Number(chain.active_uids ?? m.miners_active ?? 0);
      const minersTotal = Number(chain.total_neurons ?? 0);
      const maxN = Number(chain.max_n ?? 256);
      const uidUsage = maxN > 0 ? minersActive / maxN : 0;

      // Emission data
      const emission = Number(chain.emission || 0);
      const emissionShare = totalEmission > 0 ? (emission / totalEmission) * 100 : 0;

      // Price data from raw_payload
      const price = Number(payload?.price || 0);
      const marketCap = Number(payload?.market_cap || 0) / RAO;
      const vol24h = Number(payload?.tao_volume_24_hr || 0) / RAO;
      const priceChange1d = Number(payload?.price_change_1_day || 0);
      const priceChange1w = Number(payload?.price_change_1_week || 0);
      const priceChange1m = Number(payload?.price_change_1_month || 0);
      const fgi = Number(payload?.fear_and_greed_index || 50);

      // Metagraph-derived metrics
      let holdersCount = 0;
      let stakeConcentration = 0;
      let top10Stake: any[] = [];
      let validatorsActive = 0;

      const meta = metagraphData.get(nid);
      if (meta && Array.isArray(meta)) {
        const stakers = new Set<string>();
        const stakesByAddr: Record<string, number> = {};

        for (const neuron of meta) {
          const coldkey = neuron.coldkey?.ss58 || neuron.coldkey || "";
          if (coldkey) {
            stakers.add(coldkey);
            const s = Number(neuron.stake ?? neuron.total_stake ?? 0) / RAO;
            stakesByAddr[coldkey] = (stakesByAddr[coldkey] || 0) + s;
          }
          if (neuron.is_validator || neuron.validator_permit) validatorsActive++;
        }

        holdersCount = stakers.size;

        const sorted = Object.entries(stakesByAddr)
          .map(([addr, stake]) => ({ address: addr, stake }))
          .sort((a, b) => b.stake - a.stake);

        const totalFromMeta = sorted.reduce((s, x) => s + x.stake, 0);
        const top10Total = sorted.slice(0, 10).reduce((s, x) => s + x.stake, 0);
        stakeConcentration = totalFromMeta > 0 ? (top10Total / totalFromMeta) * 100 : 0;
        top10Stake = sorted.slice(0, 10).map((x) => ({
          address: x.address.slice(0, 8) + "…",
          stake: Math.round(x.stake),
          pct: totalFromMeta > 0 ? Math.round((x.stake / totalFromMeta) * 100) : 0,
        }));
      } else {
        // Use previous data
        const prev = prevMap.get(nid);
        holdersCount = prev?.holders_count || 0;
        stakeConcentration = Number(prev?.stake_concentration || 0);
        validatorsActive = prev?.validators_active || 0;
      }

      // Per-subnet whale flows (fallback to share of global if no subnet-specific data)
      const subnetWhales = whaleFlowMap.get(nid);
      const whaleInflow = subnetWhales ? Math.round(subnetWhales.inflow) : 0;
      const whaleOutflow = subnetWhales ? Math.round(subnetWhales.outflow) : 0;

      rows.push({
        netuid: nid,
        ts: tsRounded,
        holders_count: holdersCount,
        stake_total: stakeTotal,
        stake_concentration: Math.round(stakeConcentration * 10) / 10,
        top10_stake: top10Stake,
        validators_active: validatorsActive,
        miners_total: minersTotal,
        miners_active: minersActive,
        uid_usage: Math.round(uidUsage * 1000) / 1000,
        large_wallet_inflow: whaleInflow,
        large_wallet_outflow: whaleOutflow,
        raw_data: {
          chain,
          metagraph_available: metagraphData.has(nid),
          emission,
          emission_share: Math.round(emissionShare * 100) / 100,
          price,
          market_cap: marketCap,
          vol_24h: vol24h,
          price_change_1d: priceChange1d,
          price_change_1w: priceChange1w,
          price_change_1m: priceChange1m,
          fear_greed: fgi,
          alpha_staked: alphaStaked,
          total_tao: totalTao,
        },
      });
    }

    // 6. Insert
    if (rows.length > 0) {
      const { error: insertErr } = await sb.from("subnet_stake_analytics").insert(rows);
      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
    }

    console.log(
      `Stake analytics: ${rows.length} subnets, ${metagraphData.size} metagraphs (slice ${sliceIndex + 1}/${totalSlices})`
    );
    return new Response(
      JSON.stringify({ ok: true, processed: rows.length, metagraphs: metagraphData.size }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sync-stake-analytics error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
