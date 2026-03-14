/* ═══════════════════════════════════════ */
/*   SYNC TAOFLUTE DATA                     */
/*   Scrapes taoflute.com for delist risk   */
/*   data and updates external tables       */
/*   Fallback: keeps last known snapshot    */
/* ═══════════════════════════════════════ */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TAOFLUTE_URL = "https://taoflute.com";
const SCRAPE_TIMEOUT_MS = 10_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const result = {
    status: "ok" as "ok" | "degraded" | "unavailable",
    subnetsUpdated: 0,
    metricsUpdated: 0,
    errors: [] as string[],
  };

  try {
    // Attempt to fetch taoflute.com overview page
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

    let html: string;
    try {
      const resp = await fetch(TAOFLUTE_URL, {
        signal: controller.signal,
        headers: {
          "User-Agent": "TAO-Sentinel/1.0 (monitoring; contact: support@taosentinel.com)",
          "Accept": "text/html",
        },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      html = await resp.text();
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      result.status = "unavailable";
      result.errors.push(`Fetch failed: ${fetchErr.message}`);

      // Log source unavailable event
      await supabase.from("external_delist_events").insert({
        netuid: 0,
        event_type: "source_unavailable",
        new_value: fetchErr.message,
        source: "taoflute_scrape",
      });

      // Mark existing metrics as stale
      await supabase
        .from("external_taoflute_metrics")
        .update({ is_stale: true })
        .neq("is_stale", true);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse HTML to extract subnet data
    // Taoflute uses table-based layout. Extract rows with subnet metrics.
    const subnetRows = parseSubnetRows(html);

    if (subnetRows.length === 0) {
      result.status = "degraded";
      result.errors.push("No subnet data found in HTML — structure may have changed");
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert taoflute metrics
    for (const row of subnetRows) {
      const { error } = await supabase
        .from("external_taoflute_metrics")
        .upsert(
          {
            netuid: row.netuid,
            liq_price: row.liqPrice,
            liq_haircut: row.liqHaircut,
            flags: row.flags,
            raw_data: row.rawData,
            source: "taoflute_scrape",
            scraped_at: new Date().toISOString(),
            is_stale: false,
          },
          { onConflict: "netuid" }
        );
      if (!error) result.metricsUpdated++;
    }

    // Try to extract deregistration lists from the page
    const deregLists = parseDeregistrationLists(html);

    if (deregLists.priority.length > 0 || deregLists.watch.length > 0) {
      // Reconcile priority list
      for (const item of deregLists.priority) {
        // Check if already exists
        const { data: existing } = await supabase
          .from("external_delist_priority")
          .select("delist_rank")
          .eq("netuid", item.netuid)
          .maybeSingle();

        if (!existing) {
          // New entry
          await supabase.from("external_delist_priority").upsert(
            {
              netuid: item.netuid,
              subnet_name: item.name,
              delist_rank: item.rank,
              source: "taoflute_scrape",
              last_seen_at: new Date().toISOString(),
              is_active: true,
            },
            { onConflict: "netuid" }
          );
          await supabase.from("external_delist_events").insert({
            netuid: item.netuid,
            event_type: "added_priority",
            new_value: `rank_${item.rank}`,
            source: "taoflute_scrape",
          });
        } else if (existing.delist_rank !== item.rank) {
          // Rank changed
          await supabase
            .from("external_delist_priority")
            .update({
              delist_rank: item.rank,
              last_seen_at: new Date().toISOString(),
              source: "taoflute_scrape",
            })
            .eq("netuid", item.netuid);
          await supabase.from("external_delist_events").insert({
            netuid: item.netuid,
            event_type: "rank_changed",
            old_value: `rank_${existing.delist_rank}`,
            new_value: `rank_${item.rank}`,
            source: "taoflute_scrape",
          });
        } else {
          // Just update last_seen
          await supabase
            .from("external_delist_priority")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("netuid", item.netuid);
        }
        result.subnetsUpdated++;
      }

      // Reconcile watch list similarly
      for (const item of deregLists.watch) {
        const { data: existingP } = await supabase
          .from("external_delist_priority")
          .select("netuid")
          .eq("netuid", item.netuid)
          .maybeSingle();

        if (existingP) {
          // Already in priority — skip (priority takes precedence)
          continue;
        }

        const { data: existing } = await supabase
          .from("external_delist_watch")
          .select("netuid")
          .eq("netuid", item.netuid)
          .maybeSingle();

        if (!existing) {
          await supabase.from("external_delist_watch").upsert(
            {
              netuid: item.netuid,
              subnet_name: item.name,
              source: "taoflute_scrape",
              last_seen_at: new Date().toISOString(),
              is_active: true,
            },
            { onConflict: "netuid" }
          );
          await supabase.from("external_delist_events").insert({
            netuid: item.netuid,
            event_type: "added_watch",
            source: "taoflute_scrape",
          });
        } else {
          await supabase
            .from("external_delist_watch")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("netuid", item.netuid);
        }
        result.subnetsUpdated++;
      }
    }

    result.status = result.errors.length > 0 ? "degraded" : "ok";

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    result.status = "unavailable";
    result.errors.push(err.message);
    return new Response(JSON.stringify(result), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/* ── HTML Parsing Helpers ── */

type ParsedSubnetRow = {
  netuid: number;
  name: string;
  liqPrice: number | null;
  liqHaircut: number | null;
  flags: string[];
  rawData: Record<string, any>;
};

function parseSubnetRows(html: string): ParsedSubnetRow[] {
  const rows: ParsedSubnetRow[] = [];

  // Extract table rows containing subnet data
  // Pattern: look for rows with SN-<number> or netuid references
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1];

    // Extract netuid from the row
    const netuidMatch = rowHtml.match(/SN[- ]?(\d+)/i) || rowHtml.match(/netuid[:\s"]*(\d+)/i);
    if (!netuidMatch) continue;
    const netuid = parseInt(netuidMatch[1], 10);
    if (isNaN(netuid) || netuid < 1) continue;

    // Extract cells
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]*>/g, "").trim());
    }

    // Try to extract name
    const nameMatch = rowHtml.match(/class="[^"]*name[^"]*"[^>]*>([^<]+)/i);
    const name = nameMatch ? nameMatch[1].trim() : `SN-${netuid}`;

    // Try to find liq price and haircut values
    let liqPrice: number | null = null;
    let liqHaircut: number | null = null;
    const flags: string[] = [];

    for (const cell of cells) {
      // Liq price patterns
      const lpMatch = cell.match(/(\d+\.?\d*)\s*(?:τ|TAO|tao)/i);
      if (lpMatch && liqPrice === null) {
        liqPrice = parseFloat(lpMatch[1]);
      }

      // Haircut patterns (percentage)
      const hcMatch = cell.match(/(-?\d+\.?\d*)%/);
      if (hcMatch && liqHaircut === null) {
        const val = parseFloat(hcMatch[1]);
        if (Math.abs(val) <= 100) liqHaircut = val;
      }

      // Flag detection
      if (/🔴|red|danger|critical/i.test(cell)) flags.push("danger");
      if (/🟡|yellow|warning|caution/i.test(cell)) flags.push("warning");
      if (/delist|deregist/i.test(cell)) flags.push("delist_risk");
    }

    rows.push({
      netuid,
      name,
      liqPrice,
      liqHaircut,
      flags,
      rawData: { cells },
    });
  }

  return rows;
}

type DeregItem = { netuid: number; name: string; rank: number };

function parseDeregistrationLists(html: string): {
  priority: DeregItem[];
  watch: DeregItem[];
} {
  const priority: DeregItem[] = [];
  const watch: DeregItem[] = [];

  // Look for sections mentioning deregistration/delist priority
  const sections = html.split(/<(?:h[1-6]|div)[^>]*>/i);
  for (const section of sections) {
    const isDeregSection = /deregist|delist|priority/i.test(section);
    if (!isDeregSection) continue;

    // Extract numbered items: "1. Name (SN-XX)" or "#1 Name SN-XX"
    const itemRegex = /(?:#|rank\s*)?(\d{1,2})\s*[.:)\-]\s*([^(]*?)\s*(?:\(|\[)?SN[- ]?(\d+)/gi;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(section)) !== null) {
      const rank = parseInt(itemMatch[1], 10);
      const name = itemMatch[2].trim();
      const netuid = parseInt(itemMatch[3], 10);
      if (rank <= 10 && netuid > 0) {
        priority.push({ netuid, name, rank });
      } else if (netuid > 0) {
        watch.push({ netuid, name, rank });
      }
    }

    // Also try simpler pattern: "SN-XX" in a list context
    if (priority.length === 0 && watch.length === 0) {
      const simpleRegex = /SN[- ]?(\d+)/gi;
      let simpleMatch;
      let idx = 0;
      while ((simpleMatch = simpleRegex.exec(section)) !== null) {
        const netuid = parseInt(simpleMatch[1], 10);
        if (netuid > 0) {
          idx++;
          if (idx <= 10 && /priority|critical|imminent/i.test(section)) {
            priority.push({ netuid, name: `SN-${netuid}`, rank: idx });
          } else {
            watch.push({ netuid, name: `SN-${netuid}`, rank: idx });
          }
        }
      }
    }
  }

  return { priority, watch };
}
