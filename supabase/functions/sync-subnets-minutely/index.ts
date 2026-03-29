import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.43/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Names we treat as "no real name" */
const INVALID_NAMES = new Set(["Unknown", "Pending", "", "null", "undefined", "Subnet"]);

function isValidName(n: unknown): n is string {
  if (typeof n !== "string") return false;
  const t = n.trim();
  if (t.length === 0 || INVALID_NAMES.has(t)) return false;
  if (/^(Subnet\s*\d+|SN-\d+)$/i.test(t)) return false;
  return true;
}

/** Source priority: taostats_identity > taostats_latest > subnetalpha */
const SOURCE_PRIORITY: Record<string, number> = {
  taostats_identity: 100,
  taostats_latest: 80,
  taostats: 80,
  subnetalpha: 60,
  unknown: 0,
};

function shouldOverwrite(oldSource: string | null, newSource: string): boolean {
  return (SOURCE_PRIORITY[newSource] ?? 0) >= (SOURCE_PRIORITY[oldSource ?? "unknown"] ?? 0);
}

// ── API call logger ──
async function logApiCall(sb: any, fn: string, endpoint: string, opts: {
  statusCode?: number; cached?: boolean; deduplicated?: boolean;
  rateLimited?: boolean; responseMs?: number; error?: string; metadata?: any;
}) {
  try {
    await sb.from("api_call_log").insert({
      function_name: fn,
      endpoint,
      status_code: opts.statusCode ?? null,
      cached: opts.cached ?? false,
      deduplicated: opts.deduplicated ?? false,
      rate_limited: opts.rateLimited ?? false,
      response_ms: opts.responseMs ?? null,
      error_message: opts.error ?? null,
      metadata: opts.metadata ?? {},
    });
  } catch { /* non-blocking */ }
}

// ── TTL cache check ──
async function shouldFetch(sb: any, cacheKey: string, ttlMinutes: number, fnName: string): Promise<boolean> {
  const { data } = await sb.from("api_cache_state")
    .select("last_fetched_at, ttl_minutes")
    .eq("cache_key", cacheKey)
    .single();

  if (!data) return true;

  const elapsed = (Date.now() - new Date(data.last_fetched_at).getTime()) / 60000;
  if (elapsed < (data.ttl_minutes || ttlMinutes)) {
    console.log(`[name-sync] Cache HIT for ${cacheKey} (${Math.round(elapsed)}m < ${ttlMinutes}m TTL)`);
    return false;
  }
  return true;
}

async function updateCacheState(sb: any, cacheKey: string, ttlMinutes: number, fnName: string) {
  await sb.from("api_cache_state").upsert({
    cache_key: cacheKey,
    last_fetched_at: new Date().toISOString(),
    ttl_minutes: ttlMinutes,
    function_name: fnName,
  }, { onConflict: "cache_key" });
}

// ── SubnetAlpha Fallback ──
async function fetchSubnetAlphaNames(): Promise<Record<number, string>> {
  const result: Record<number, string> = {};
  try {
    const res = await fetch("https://subnetalpha.ai/", {
      headers: { "User-Agent": "TaoSentinel/1.0", Accept: "text/html" },
    });
    if (!res.ok) { await res.text(); return result; }
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) return result;
    const fullText = doc.body?.textContent ?? "";
    const regex = /Subnet\s+(\d+)\s*\n+\s*#?\s*([^\n]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(fullText)) !== null) {
      const netuid = parseInt(match[1], 10);
      const name = match[2].trim();
      if (!isNaN(netuid) && isValidName(name)) result[netuid] = name;
    }
    console.log(`[name-sync] SubnetAlpha: resolved ${Object.keys(result).length} names`);
  } catch (e) {
    console.warn("[name-sync] SubnetAlpha fetch failed:", e);
  }
  return result;
}

const FN_NAME = "sync-subnets-minutely";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;

    // ── 1. Get subnet list from DB (NO API call — sync-metrics already populates this) ──
    const { data: dbSubnets } = await sb.from("subnets").select("netuid, name, canonical_name, source_name");
    const existingMap = new Map<number, { name: string | null; canonical_name: string | null; source_name: string | null }>();
    for (const s of dbSubnets || []) {
      existingMap.set(s.netuid, { name: s.name, canonical_name: s.canonical_name, source_name: s.source_name });
    }

    // Also get netuids from subnet_latest that might not be in subnets table yet
    const { data: latestNetuids } = await sb.from("subnet_latest").select("netuid");
    const allNetuids = new Set<number>();
    for (const s of dbSubnets || []) allNetuids.add(s.netuid);
    for (const s of latestNetuids || []) if (s.netuid) allNetuids.add(s.netuid as number);

    // Build a subnet-like array for iteration (replaces the old Taostats subnet/latest call)
    const subnets = [...allNetuids].map(netuid => ({ netuid }));
    console.log(`[name-sync] ${subnets.length} subnets from DB (0 API calls for list)`);

    await logApiCall(sb, FN_NAME, "subnet/latest/v1", {
      deduplicated: true, metadata: { reason: "using DB data from sync-metrics", count: subnets.length },
    });

    // ── 2. Build name map from API sources ──
    const nameMap: Record<number, { name: string; source: string }> = {};
    let taostatsAvailable = true;

    // 2a. Taostats Identity API (highest priority) — TTL 6h
    const identityCacheKey = "taostats_identity_all";
    const shouldFetchIdentity = await shouldFetch(sb, identityCacheKey, 360, FN_NAME);

    if (shouldFetchIdentity) {
      const t0 = Date.now();
      try {
        const idRes = await fetch("https://api.taostats.io/api/subnet/identity/v1", {
          headers: { Authorization: apiKey, Accept: "application/json" },
        });
        const ms = Date.now() - t0;

        if (idRes.ok) {
          const idJson = await idRes.json();
          const identities = Array.isArray(idJson) ? idJson : idJson.data || [];
          for (const identity of identities) {
            const nid = Number(identity.netuid);
            if (isNaN(nid)) continue;
            const name = identity.subnet_name || identity.name || identity.identity_name || null;
            if (isValidName(name)) {
              nameMap[nid] = { name: name!.trim(), source: "taostats_identity" };
            }
          }
          console.log(`[name-sync] Taostats identity: ${Object.keys(nameMap).length} names`);
          await logApiCall(sb, FN_NAME, "subnet/identity/v1", { statusCode: 200, responseMs: ms });
          await updateCacheState(sb, identityCacheKey, 360, FN_NAME);
        } else if (idRes.status === 429) {
          console.warn("[name-sync] Identity API rate-limited (429)");
          await idRes.text();
          taostatsAvailable = false;
          await logApiCall(sb, FN_NAME, "subnet/identity/v1", { statusCode: 429, rateLimited: true, responseMs: ms });
        } else {
          console.warn("[name-sync] Identity API returned:", idRes.status);
          await idRes.text();
          await logApiCall(sb, FN_NAME, "subnet/identity/v1", { statusCode: idRes.status, responseMs: ms });
        }
      } catch (e) {
        taostatsAvailable = false;
        await logApiCall(sb, FN_NAME, "subnet/identity/v1", { error: String(e) });
      }
    } else {
      await logApiCall(sb, FN_NAME, "subnet/identity/v1", { cached: true });
    }

    // 2b. Extract names from raw_payload in subnet_metrics_ts (replaces subnet/latest API call)
    // sync-metrics already stores full subnet data in raw_payload._chain
    if (Object.keys(nameMap).length < subnets.length * 0.8) {
      const { data: payloadRows } = await sb.from("subnet_latest")
        .select("netuid, raw_payload")
        .not("raw_payload", "is", null);

      for (const row of payloadRows || []) {
        const nid = Number(row.netuid);
        if (isNaN(nid) || nameMap[nid]) continue;
        const p = row.raw_payload as any;
        const chain = p?._chain;
        const fallbackName = p?.subnet_name || p?.name || chain?.name || null;
        if (isValidName(fallbackName)) {
          nameMap[nid] = { name: fallbackName!.trim(), source: "taostats_latest" };
        }
      }
      console.log(`[name-sync] raw_payload names: ${Object.keys(nameMap).length} total (no API call)`);
    }

    // 2c. SubnetAlpha fallback — TTL 6h
    const alphaCacheKey = "subnetalpha_names";
    const shouldFetchAlpha = await shouldFetch(sb, alphaCacheKey, 360, FN_NAME);
    let alphaFilled = 0;

    if (shouldFetchAlpha) {
      const alphaNames = await fetchSubnetAlphaNames();
      for (const [nidStr, name] of Object.entries(alphaNames)) {
        const nid = Number(nidStr);
        if (!nameMap[nid] && isValidName(name)) {
          nameMap[nid] = { name, source: "subnetalpha" };
          alphaFilled++;
        }
      }
      if (alphaFilled > 0) console.log(`[name-sync] SubnetAlpha filled ${alphaFilled} additional names`);
      await updateCacheState(sb, alphaCacheKey, 360, FN_NAME);
      await logApiCall(sb, FN_NAME, "subnetalpha.ai/scrape", { statusCode: 200, metadata: { filled: alphaFilled } });
    } else {
      await logApiCall(sb, FN_NAME, "subnetalpha.ai/scrape", { cached: true });
    }

    console.log(`[name-sync] Total resolved names: ${Object.keys(nameMap).length}`);

    // ── 3. Upsert subnets ──
    const now = new Date().toISOString();
    let updated = 0, namesUpdated = 0, namesConflicts = 0, errors = 0;

    for (const s of subnets) {
      const netuid = Number(s.netuid);
      if (isNaN(netuid)) continue;

      const resolved = nameMap[netuid];
      const newName = resolved?.name ?? null;
      const nameSource = resolved?.source ?? "unknown";
      const existingRow = existingMap.get(netuid);
      const isNew = !existingRow;

      if (isNew) {
        const { error } = await sb.from("subnets").insert({
          netuid, name: newName, canonical_name: newName, display_name: newName,
          source_name: nameSource,
          name_updated_at: newName ? now : null,
          first_seen_at: now, last_seen_at: now,
        });
        if (error) { console.error(`[name-sync] Insert ${netuid}:`, error); errors++; }
        await sb.from("events").insert({
          netuid, ts: now, type: "CREATED", severity: 1,
          evidence: { source: nameSource },
        });
      } else {
        const updatePayload: Record<string, any> = { last_seen_at: now };
        const oldName = existingRow!.canonical_name || existingRow!.name;
        const oldSource = existingRow!.source_name;
        const oldNameInvalid = !isValidName(oldName);
        const newNameValid = isValidName(newName);

        if (newNameValid && (oldNameInvalid || (oldName !== newName && shouldOverwrite(oldSource, nameSource)))) {
          if (!oldNameInvalid && oldName !== newName) {
            console.log(`[name-sync] CONFLICT netuid=${netuid}: "${oldName}" (${oldSource}) → "${newName}" (${nameSource})`);
            namesConflicts++;
          }
          updatePayload.name = newName;
          updatePayload.canonical_name = newName;
          updatePayload.display_name = newName;
          updatePayload.source_name = nameSource;
          updatePayload.name_updated_at = now;
          namesUpdated++;
        }

        if (Object.keys(updatePayload).length > 1) {
          const { error } = await sb.from("subnets").update(updatePayload).eq("netuid", netuid);
          if (error) { console.error(`[name-sync] Update ${netuid}:`, error); errors++; }
          else { updated++; }
        }
      }
    }

    const summary = {
      ok: true,
      taostats_available: taostatsAvailable,
      api_calls_saved: 1, // subnet/latest no longer called
      count: subnets.length,
      updated, names_updated: namesUpdated,
      names_conflicts: namesConflicts, errors,
      names_resolved: Object.keys(nameMap).length,
      subnetalpha_filled: alphaFilled,
      identity_cached: !shouldFetchIdentity,
      alpha_cached: !shouldFetchAlpha,
    };
    console.log(`[name-sync] Done:`, JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[name-sync] error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
