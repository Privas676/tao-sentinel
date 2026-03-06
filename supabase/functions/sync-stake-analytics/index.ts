import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RAO = 1e9;
const METAGRAPH_PER_RUN = 5;
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

/** Fetch bulk subnet data from Taostats subnet/latest/v1 (single call, all subnets) */
async function fetchBulkSubnetData(headers: Record<string, string>): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  try {
    const url = "https://api.taostats.io/api/subnet/latest/v1";
    const res = await fetchWithRetry(url, { headers });
    if (res.ok) {
      const json = await res.json();
      const subnets = json.data || json;
      if (Array.isArray(subnets)) {
        for (const s of subnets) {
          const nid = Number(s.netuid);
          if (nid > 0) map.set(nid, s);
        }
      }
      console.log(`Bulk subnet data: ${map.size} subnets fetched`);
    } else {
      console.log(`Bulk subnet fetch failed: ${res.status}`);
      await res.text();
    }
  } catch (e) {
    console.error("Bulk subnet fetch error:", e);
  }
  return map;
}

/** Extract validator/concentration data from metagraph neurons */
function analyzeMetagraph(neurons: any[]): {
  holdersCount: number;
  stakeConcentration: number;
  top10Stake: any[];
  validatorsActive: number;
} {
  const stakers = new Set<string>();
  const stakesByAddr: Record<string, number> = {};
  let validatorsActive = 0;
  let sampleNeuron: any = null;

  for (const neuron of neurons) {
    if (!sampleNeuron) sampleNeuron = neuron;
    const coldkey = neuron.coldkey?.ss58 || neuron.coldkey || "";
    if (coldkey) {
      stakers.add(coldkey);
      const s = Number(neuron.stake ?? neuron.total_stake ?? 0) / RAO;
      stakesByAddr[coldkey] = (stakesByAddr[coldkey] || 0) + s;
    }
    if (neuron.is_validator || neuron.validator_permit) validatorsActive++;
  }

  const sorted = Object.entries(stakesByAddr)
    .map(([addr, stake]) => ({ address: addr, stake }))
    .sort((a, b) => b.stake - a.stake);

  const totalFromMeta = sorted.reduce((s, x) => s + x.stake, 0);
  const top10Total = sorted.slice(0, 10).reduce((s, x) => s + x.stake, 0);
  const stakeConcentration = totalFromMeta > 0 ? (top10Total / totalFromMeta) * 100 : 0;

  // Debug: log metagraph analysis results
  console.log(`[META-DEBUG] neurons=${neurons.length}, stakers=${stakers.size}, validators=${validatorsActive}, totalStake=${totalFromMeta.toFixed(2)}, top10=${top10Total.toFixed(2)}, conc=${stakeConcentration.toFixed(1)}%`);
  if (sampleNeuron) {
    const keys = Object.keys(sampleNeuron).join(",");
    console.log(`[META-DEBUG] sample neuron keys: ${keys}`);
    console.log(`[META-DEBUG] sample coldkey=${JSON.stringify(sampleNeuron.coldkey)}, stake=${sampleNeuron.stake}, total_stake=${sampleNeuron.total_stake}`);
  }

  const top10Stake = sorted.slice(0, 10).map((x) => ({
    address: x.address.slice(0, 8) + "…",
    stake: Math.round(x.stake),
    pct: totalFromMeta > 0 ? Math.round((x.stake / totalFromMeta) * 100) : 0,
  }));

  return {
    holdersCount: stakers.size,
    stakeConcentration,
    top10Stake,
    validatorsActive,
  };
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

    // 1. Get lightweight subnet list (no raw_payload to avoid timeout)
    const { data: subnetList, error: listErr } = await sb
      .from("subnet_latest")
      .select("netuid, miners_active, ts");
    if (listErr) throw new Error(`Failed to fetch latest: ${listErr.message}`);
    if (!subnetList?.length) {
      return new Response(JSON.stringify({ ok: true, message: "No data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const netuidList = subnetList.map((m) => m.netuid).filter(Boolean) as number[];

    // Fetch raw_payload in batches of 30 to avoid statement timeout
    const rawPayloadMap = new Map<number, any>();
    const BATCH_SIZE = 30;
    for (let i = 0; i < netuidList.length; i += BATCH_SIZE) {
      const batch = netuidList.slice(i, i + BATCH_SIZE);
      const { data: batchData } = await sb
        .from("subnet_latest")
        .select("netuid, raw_payload")
        .in("netuid", batch);
      for (const row of batchData || []) {
        if (row.netuid) rawPayloadMap.set(row.netuid as number, row.raw_payload);
      }
    }

    // Merge into unified latestMetrics
    const latestMetrics = subnetList.map((m) => ({
      ...m,
      raw_payload: rawPayloadMap.get(m.netuid as number) || null,
    }));
    const now = Date.now();
    const ts24hAgo = new Date(now - 24 * 3600_000).toISOString();

    // 2. Parallel: fetch previous analytics, bulk subnet data from Taostats, whale movements
    const [prevAnalyticsRes, bulkSubnetData, whalesRes] = await Promise.all([
      sb.from("subnet_stake_analytics")
        .select("netuid, holders_count, stake_concentration, validators_active, stake_total, miners_active, top10_stake")
        .in("netuid", netuidList)
        .order("ts", { ascending: false })
        .limit(500),
      fetchBulkSubnetData(headers),
      sb.from("whale_movements")
        .select("direction, amount_tao, netuid")
        .gte("detected_at", ts24hAgo),
    ]);
    const prevMap = dedupeLatest(prevAnalyticsRes.data || []);

    // 3. Round-robin metagraph fetch for detailed stake concentration analysis
    const minuteOfHour = new Date().getMinutes();
    const totalSlices = Math.ceil(netuidList.length / METAGRAPH_PER_RUN);
    const sliceIndex = Math.floor(minuteOfHour / 15) % totalSlices;
    const start = sliceIndex * METAGRAPH_PER_RUN;
    const metagraphBatch = netuidList.slice(start, start + METAGRAPH_PER_RUN);

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

    // 4. Whale flows per subnet
    const whaleFlowMap = new Map<number, { inflow: number; outflow: number }>();
    for (const w of whalesRes.data || []) {
      const nid = w.netuid || 0;
      const entry = whaleFlowMap.get(nid) || { inflow: 0, outflow: 0 };
      if (w.direction === "IN") entry.inflow += Number(w.amount_tao);
      else entry.outflow += Number(w.amount_tao);
      whaleFlowMap.set(nid, entry);
    }

    // Compute total emission for emission share
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
      const bulkSN = bulkSubnetData.get(nid);
      const prev = prevMap.get(nid);

      // Extract real stake from raw_payload
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

      // Price data
      const price = Number(payload?.price || 0);
      const marketCap = Number(payload?.market_cap || 0) / RAO;
      const vol24h = Number(payload?.tao_volume_24_hr || 0) / RAO;
      const priceChange1d = Number(payload?.price_change_1_day || 0);
      const priceChange1w = Number(payload?.price_change_1_week || 0);
      const priceChange1m = Number(payload?.price_change_1_month || 0);
      const fgi = Number(payload?.fear_and_greed_index || 50);

      // === Determine validators, holders, concentration ===
      let holdersCount = 0;
      let stakeConcentration = 0;
      let top10Stake: any[] = [];
      let validatorsActive = 0;

      // Priority 1: Metagraph data (most accurate - has neuron-level stake analysis)
      const meta = metagraphData.get(nid);
      if (meta) {
        const isArr = Array.isArray(meta);
        const metaType = typeof meta;
        const metaKeys = meta && !isArr ? Object.keys(meta).slice(0, 10).join(",") : "N/A";
        console.log(`[META-DEBUG] SN-${nid}: isArray=${isArr}, type=${metaType}, keys=${metaKeys}, length=${isArr ? meta.length : "N/A"}`);
        
        // Handle both array format and object-with-data format
        const neurons = isArr ? meta : (Array.isArray(meta.data) ? meta.data : null);
        
        if (neurons && neurons.length > 0) {
          const analysis = analyzeMetagraph(neurons);
          holdersCount = analysis.holdersCount;
          stakeConcentration = analysis.stakeConcentration;
          top10Stake = analysis.top10Stake;
          validatorsActive = analysis.validatorsActive;
          console.log(`[META-DEBUG] SN-${nid}: conc=${stakeConcentration.toFixed(1)}%, holders=${holdersCount}, validators=${validatorsActive}`);
        }
      } else {
        // Priority 2: Bulk Taostats subnet data (has validator count, registration info)
        if (bulkSN) {
          // Extract validator count from bulk subnet data
          // Taostats subnet/latest returns fields like num_validators, active_validators
          validatorsActive = Number(
            bulkSN.active_validators ?? bulkSN.num_validators ?? bulkSN.validators ?? 0
          );
          // Registration-based holder estimate
          const regCount = Number(bulkSN.registration_count ?? bulkSN.registrations ?? 0);
          if (regCount > 0) holdersCount = regCount;
        }

        // Priority 3: Previous analytics data (carry forward from last metagraph scan)
        if (!validatorsActive && prev) {
          validatorsActive = prev.validators_active || 0;
        }
        if (!holdersCount && prev) {
          holdersCount = prev.holders_count || 0;
        }
        if (prev) {
          stakeConcentration = Number(prev.stake_concentration || 0);
          top10Stake = prev.top10_stake || [];
        }

        // Priority 4: Chain data fallback for validators
        if (!validatorsActive) {
          // Estimate validators from chain data: typically ~10-20% of total neurons have permits
          const validatorPermits = Number(chain.validator_permits ?? 0);
          if (validatorPermits > 0) validatorsActive = validatorPermits;
        }
      }

      // Per-subnet whale flows
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
          bulk_subnet_available: bulkSubnetData.has(nid),
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

    // Log summary with validator coverage
    const withValidators = rows.filter((r) => r.validators_active > 0).length;
    const withConcentration = rows.filter((r) => r.stake_concentration > 0).length;
    console.log(
      `Stake analytics: ${rows.length} subnets, ${metagraphData.size} metagraphs (slice ${sliceIndex + 1}/${totalSlices}), ` +
      `bulk: ${bulkSubnetData.size}, validators: ${withValidators}/${rows.length}, conc: ${withConcentration}/${rows.length}`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        processed: rows.length,
        metagraphs: metagraphData.size,
        bulkSubnets: bulkSubnetData.size,
        withValidators,
        withConcentration,
      }),
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
