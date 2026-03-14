/* ═══════════════════════════════════════ */
/*   SYNC TAOFLUTE DATA                     */
/*   Queries taoflute.com Grafana API       */
/*   for subnet metrics & delist risk       */
/*   Reconciles with seed list + history    */
/* ═══════════════════════════════════════ */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TAOFLUTE_BASE = "https://taoflute.com";
const DATASOURCE_UID = "eeza6pofrbgn4d";
const SCRAPE_TIMEOUT_MS = 12_000;

/* ── Grafana ds/query helper ── */
async function grafanaQuery(rawSql: string, signal: AbortSignal): Promise<any> {
  const resp = await fetch(`${TAOFLUTE_BASE}/api/ds/query`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "TAO-Sentinel/1.0 (monitoring)",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      queries: [{
        refId: "A",
        datasource: { uid: DATASOURCE_UID },
        rawSql,
        format: "table",
      }],
      from: "now-1h",
      to: "now",
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Grafana ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

/* ── Extract table rows from Grafana response ── */
function extractRows(result: any): Record<string, any>[] {
  const frames = result?.results?.A?.frames;
  if (!frames || frames.length === 0) return [];
  const frame = frames[0];
  const schema = frame?.schema?.fields || [];
  const data = frame?.data?.values || [];
  if (schema.length === 0 || data.length === 0) return [];

  const rowCount = data[0]?.length || 0;
  const rows: Record<string, any>[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, any> = {};
    for (let j = 0; j < schema.length; j++) {
      row[schema[j].name] = data[j]?.[i] ?? null;
    }
    rows.push(row);
  }
  return rows;
}

/* ── SQL queries to try (common patterns for subnet overview tables) ── */
const SUBNET_QUERIES = [
  // Try: overview/summary table with liq data
  `SELECT * FROM subnets_overview ORDER BY netuid LIMIT 200`,
  `SELECT * FROM subnet_overview ORDER BY netuid LIMIT 200`,
  `SELECT * FROM subnets ORDER BY netuid LIMIT 200`,
  `SELECT netuid, name, liq_price, liq_haircut, price, market_cap, volume_24h, status FROM subnets ORDER BY netuid LIMIT 200`,
  // Fallback: any table with netuid
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
];

const DELIST_QUERIES = [
  `SELECT * FROM deregistration_priority ORDER BY rank LIMIT 50`,
  `SELECT * FROM delist_priority ORDER BY rank LIMIT 50`,
  `SELECT * FROM at_risk_subnets ORDER BY priority LIMIT 50`,
  `SELECT * FROM deregistration_watch LIMIT 100`,
  `SELECT * FROM delist_watch LIMIT 100`,
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const now = new Date().toISOString();

  const result = {
    status: "ok" as "ok" | "degraded" | "unavailable",
    metricsUpdated: 0,
    subnetsReconciled: 0,
    eventsLogged: 0,
    tablesFound: [] as string[],
    errors: [] as string[],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    /* ════════════════════════════════════ */
    /*   PHASE 1: Discover available tables */
    /* ════════════════════════════════════ */
    let availableTables: string[] = [];
    try {
      const schemaResult = await grafanaQuery(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
        controller.signal
      );
      availableTables = extractRows(schemaResult).map(r => r.table_name).filter(Boolean);
      result.tablesFound = availableTables;
      console.log(`Taoflute tables found: ${availableTables.length} — ${availableTables.join(", ")}`);
    } catch (e: any) {
      console.log(`Schema discovery failed: ${e.message}`);
      result.errors.push(`Schema: ${e.message}`);
    }

    /* ════════════════════════════════════ */
    /*   PHASE 2: Fetch subnet metrics      */
    /* ════════════════════════════════════ */
    let subnetRows: Record<string, any>[] = [];
    let deregData: { netuid: number; rank: number; name: string }[] = [];

    // Try known queries or build from discovered tables
    const metricsQueries = availableTables.length > 0
      ? buildSmartQueries(availableTables)
      : SUBNET_QUERIES;

    for (const sql of metricsQueries) {
      try {
        const queryResult = await grafanaQuery(sql, controller.signal);
        const rows = extractRows(queryResult);
        if (rows.length > 0) {
          subnetRows = rows;
          console.log(`Metrics query success: ${rows.length} rows from: ${sql.slice(0, 80)}`);
          break;
        }
      } catch (e: any) {
        // Try next query
        console.log(`Query failed: ${sql.slice(0, 60)} — ${e.message.slice(0, 100)}`);
      }
    }

    // Upsert metrics to external_taoflute_metrics
    if (subnetRows.length > 0) {
      for (const row of subnetRows) {
        const netuid = row.netuid ?? row.subnet_id ?? row.id;
        if (!netuid || isNaN(Number(netuid))) continue;

        const liqPrice = findNumericField(row, ["liq_price", "liquidation_price", "liq"]);
        const liqHaircut = findNumericField(row, ["liq_haircut", "haircut", "liq_discount"]);
        const flags = extractFlags(row);

        const { error } = await supabase
          .from("external_taoflute_metrics")
          .upsert({
            netuid: Number(netuid),
            liq_price: liqPrice,
            liq_haircut: liqHaircut,
            flags,
            raw_data: row,
            source: "taoflute_grafana",
            scraped_at: now,
            is_stale: false,
          }, { onConflict: "netuid" });
        if (!error) result.metricsUpdated++;
      }
      console.log(`Metrics updated: ${result.metricsUpdated}`);
    } else {
      result.status = "degraded";
      result.errors.push("No subnet metrics extracted");
    }

    /* ════════════════════════════════════ */
    /*   PHASE 3: Fetch delist lists         */
    /* ════════════════════════════════════ */
    let delistRows: Record<string, any>[] = [];
    const delistQueries = availableTables.length > 0
      ? buildDelistQueries(availableTables)
      : DELIST_QUERIES;

    for (const sql of delistQueries) {
      try {
        const queryResult = await grafanaQuery(sql, controller.signal);
        const rows = extractRows(queryResult);
        if (rows.length > 0) {
          delistRows = rows;
          console.log(`Delist query success: ${rows.length} rows from: ${sql.slice(0, 80)}`);
          break;
        }
      } catch {
        // Try next
      }
    }

    /* ════════════════════════════════════ */
    /*   PHASE 4: Reconciliation             */
    /* ════════════════════════════════════ */
    // Get current DB state
    const { data: currentPriority } = await supabase
      .from("external_delist_priority")
      .select("*")
      .eq("is_active", true);
    const { data: currentWatch } = await supabase
      .from("external_delist_watch")
      .select("*")
      .eq("is_active", true);

    const currentPriorityMap = new Map((currentPriority || []).map(p => [p.netuid, p]));
    const currentWatchMap = new Map((currentWatch || []).map(w => [w.netuid, w]));

    if (delistRows.length > 0) {
      // Parse scraped delist data
      const scrapedPriority = new Map<number, { rank: number; name: string }>();
      const scrapedWatch = new Set<number>();

      for (const row of delistRows) {
        const netuid = Number(row.netuid ?? row.subnet_id ?? row.id);
        if (!netuid || isNaN(netuid)) continue;
        const rank = Number(row.rank ?? row.priority ?? row.delist_rank ?? 0);
        const name = String(row.name ?? row.subnet_name ?? `SN-${netuid}`);

        if (rank > 0 && rank <= 10) {
          scrapedPriority.set(netuid, { rank, name });
        } else {
          scrapedWatch.add(netuid);
        }
      }

      // Reconcile priority list
      await reconcilePriority(supabase, currentPriorityMap, scrapedPriority, now, result);

      // Reconcile watch list
      await reconcileWatch(supabase, currentWatchMap, scrapedWatch, currentPriorityMap, now, result);
    } else {
      // No delist data from scrape — just update last_seen for existing seed entries
      console.log("No delist data scraped — seed list remains authoritative");
    }

    // Mark stale metrics if no data fetched
    if (subnetRows.length === 0) {
      await supabase
        .from("external_taoflute_metrics")
        .update({ is_stale: true })
        .eq("is_stale", false);
    }

    result.status = result.errors.length > 0 ? "degraded" : "ok";

  } catch (err: any) {
    result.status = "unavailable";
    result.errors.push(err.message);

    // Log source unavailable event
    await supabase.from("external_delist_events").insert({
      netuid: 0,
      event_type: "source_unavailable",
      new_value: err.message.slice(0, 200),
      source: "taoflute_grafana",
    });
    result.eventsLogged++;

    // Mark all metrics stale
    await supabase
      .from("external_taoflute_metrics")
      .update({ is_stale: true })
      .eq("is_stale", false);
  } finally {
    clearTimeout(timeout);
  }

  console.log(`sync-taoflute: ${result.status}, metrics=${result.metricsUpdated}, reconciled=${result.subnetsReconciled}, events=${result.eventsLogged}, errors=${result.errors.length}`);

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

/* ══════════════════════════════════════════ */
/*   RECONCILIATION HELPERS                    */
/* ══════════════════════════════════════════ */

async function reconcilePriority(
  supabase: any,
  currentMap: Map<number, any>,
  scraped: Map<number, { rank: number; name: string }>,
  now: string,
  result: any
) {
  // Process scraped priority items
  for (const [netuid, item] of scraped) {
    const existing = currentMap.get(netuid);

    if (!existing) {
      // New entry in priority
      await supabase.from("external_delist_priority").upsert({
        netuid,
        subnet_name: item.name,
        delist_rank: item.rank,
        source: "taoflute_grafana",
        last_seen_at: now,
        detected_at: now,
        is_active: true,
      }, { onConflict: "netuid" });
      await logEvent(supabase, netuid, "added_priority", null, `rank_${item.rank}`, "taoflute_grafana");
      result.eventsLogged++;
    } else if (existing.delist_rank !== item.rank) {
      // Rank changed
      await supabase
        .from("external_delist_priority")
        .update({
          delist_rank: item.rank,
          last_seen_at: now,
          source: "taoflute_grafana",
          updated_at: now,
        })
        .eq("netuid", netuid);
      await logEvent(supabase, netuid, "rank_changed", `rank_${existing.delist_rank}`, `rank_${item.rank}`, "taoflute_grafana");
      result.eventsLogged++;
    } else {
      // Just update last_seen
      await supabase
        .from("external_delist_priority")
        .update({ last_seen_at: now })
        .eq("netuid", netuid);
    }
    result.subnetsReconciled++;
  }

  // Detect removals: items in DB but not in scraped (only for taoflute-sourced, not seed)
  for (const [netuid, existing] of currentMap) {
    if (!scraped.has(netuid) && existing.source === "taoflute_grafana") {
      await supabase
        .from("external_delist_priority")
        .update({ is_active: false, updated_at: now })
        .eq("netuid", netuid);
      await logEvent(supabase, netuid, "removed_priority", `rank_${existing.delist_rank}`, null, "taoflute_grafana");
      result.eventsLogged++;
      result.subnetsReconciled++;
    }
  }
}

async function reconcileWatch(
  supabase: any,
  currentMap: Map<number, any>,
  scraped: Set<number>,
  priorityMap: Map<number, any>,
  now: string,
  result: any
) {
  for (const netuid of scraped) {
    // Skip if already in priority
    if (priorityMap.has(netuid)) continue;

    const existing = currentMap.get(netuid);
    if (!existing) {
      await supabase.from("external_delist_watch").upsert({
        netuid,
        source: "taoflute_grafana",
        last_seen_at: now,
        detected_at: now,
        is_active: true,
      }, { onConflict: "netuid" });
      await logEvent(supabase, netuid, "added_watch", null, null, "taoflute_grafana");
      result.eventsLogged++;
    } else {
      await supabase
        .from("external_delist_watch")
        .update({ last_seen_at: now })
        .eq("netuid", netuid);
    }
    result.subnetsReconciled++;
  }

  // Detect watch→priority promotions
  for (const [netuid, existing] of currentMap) {
    if (priorityMap.has(netuid) && existing.is_active) {
      // Promoted from watch to priority
      await supabase
        .from("external_delist_watch")
        .update({ is_active: false, updated_at: now })
        .eq("netuid", netuid);
      await logEvent(supabase, netuid, "watch_to_priority", "watch", "priority", "taoflute_grafana");
      result.eventsLogged++;
    }
  }

  // Detect removals (only taoflute-sourced)
  for (const [netuid, existing] of currentMap) {
    if (!scraped.has(netuid) && !priorityMap.has(netuid) && existing.source === "taoflute_grafana") {
      await supabase
        .from("external_delist_watch")
        .update({ is_active: false, updated_at: now })
        .eq("netuid", netuid);
      await logEvent(supabase, netuid, "removed_watch", null, null, "taoflute_grafana");
      result.eventsLogged++;
      result.subnetsReconciled++;
    }
  }
}

async function logEvent(
  supabase: any,
  netuid: number,
  eventType: string,
  oldValue: string | null,
  newValue: string | null,
  source: string
) {
  await supabase.from("external_delist_events").insert({
    netuid,
    event_type: eventType,
    old_value: oldValue,
    new_value: newValue,
    source,
  });
}

/* ══════════════════════════════════════════ */
/*   SMART QUERY BUILDERS                      */
/* ══════════════════════════════════════════ */

function buildSmartQueries(tables: string[]): string[] {
  const queries: string[] = [];
  const t = new Set(tables);

  // Priority: materialized_overview_data is the richest table
  if (t.has("materialized_overview_data")) {
    queries.push(`SELECT * FROM "materialized_overview_data" ORDER BY 1 LIMIT 200`);
  }

  // Then snapshot_history for delist-related data
  if (t.has("snapshot_history")) {
    queries.push(`SELECT * FROM "snapshot_history" ORDER BY 1 DESC LIMIT 200`);
  }

  // Then other subnet-related tables
  for (const name of tables) {
    if (name === "materialized_overview_data" || name === "snapshot_history") continue;
    if (/subnet|overview|pool|token|ohlc|price/i.test(name)) {
      queries.push(`SELECT * FROM "${name}" ORDER BY 1 LIMIT 200`);
    }
  }

  return queries.length > 0 ? queries : SUBNET_QUERIES;
}

function buildDelistQueries(tables: string[]): string[] {
  const queries: string[] = [];

  for (const name of tables) {
    if (/delist|deregist|at_risk|priority|watch/i.test(name)) {
      queries.push(`SELECT * FROM "${name}" ORDER BY 1 LIMIT 100`);
    }
  }

  return queries.length > 0 ? queries : DELIST_QUERIES;
}

/* ── Field extraction helpers ── */
function findNumericField(row: Record<string, any>, candidates: string[]): number | null {
  for (const key of candidates) {
    if (row[key] != null && !isNaN(Number(row[key]))) {
      return Number(row[key]);
    }
  }
  // Also try fuzzy match on actual keys
  for (const actualKey of Object.keys(row)) {
    for (const candidate of candidates) {
      if (actualKey.toLowerCase().includes(candidate.toLowerCase())) {
        const val = Number(row[actualKey]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return null;
}

function extractFlags(row: Record<string, any>): string[] {
  const flags: string[] = [];
  for (const [key, val] of Object.entries(row)) {
    if (/flag|risk|warning|alert|status/i.test(key) && val) {
      flags.push(`${key}:${val}`);
    }
  }
  return flags;
}
