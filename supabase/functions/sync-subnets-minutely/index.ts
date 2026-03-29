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
  // Reject generic "Subnet N" or "SN-N" patterns
  if (/^(Subnet\s*\d+|SN-\d+)$/i.test(t)) return false;
  return true;
}

/** Source priority: taostats_identity > taostats_latest > subnetalpha */
const SOURCE_PRIORITY: Record<string, number> = {
  taostats_identity: 100,
  taostats_latest: 80,
  taostats: 80,          // legacy backfill source name
  subnetalpha: 60,
  unknown: 0,
};

function shouldOverwrite(oldSource: string | null, newSource: string): boolean {
  return (SOURCE_PRIORITY[newSource] ?? 0) >= (SOURCE_PRIORITY[oldSource ?? "unknown"] ?? 0);
}

// ── SubnetAlpha Fallback: scrape directory page ──
async function fetchSubnetAlphaNames(): Promise<Record<number, string>> {
  const result: Record<number, string> = {};
  try {
    const res = await fetch("https://subnetalpha.ai/", {
      headers: { "User-Agent": "TaoSentinel/1.0", Accept: "text/html" },
    });
    if (!res.ok) {
      console.warn(`[name-sync] SubnetAlpha returned ${res.status}`);
      await res.text();
      return result;
    }
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) return result;

    // The page structure: "Subnet NN" text followed by "# Name" in headings
    // Parse all text content looking for patterns
    const fullText = doc.body?.textContent ?? "";
    
    // Match patterns like "Subnet 67\n\nTenex" or "Subnet 07\n\nSubnet 7"
    const regex = /Subnet\s+(\d+)\s*\n+\s*#?\s*([^\n]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(fullText)) !== null) {
      const netuid = parseInt(match[1], 10);
      const name = match[2].trim();
      if (!isNaN(netuid) && isValidName(name)) {
        result[netuid] = name;
      }
    }
    console.log(`[name-sync] SubnetAlpha: resolved ${Object.keys(result).length} names`);
  } catch (e) {
    console.warn("[name-sync] SubnetAlpha fetch failed:", e);
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    let taostatsAvailable = true;
    let subnets: any[] = [];

    // ── 1. Try Taostats subnet list (primary) ──
    try {
      const res = await fetch("https://api.taostats.io/api/subnet/latest/v1", {
        headers: { Authorization: apiKey, Accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        subnets = Array.isArray(json) ? json : json.data || json.subnets || [];
        console.log(`[name-sync] Taostats: ${subnets.length} subnets`);
      } else {
        console.warn(`[name-sync] Taostats subnet/latest returned ${res.status}`);
        await res.text();
        taostatsAvailable = false;
      }
    } catch (e) {
      console.warn("[name-sync] Taostats subnet/latest failed:", e);
      taostatsAvailable = false;
    }

    // ── 2. Build name map from all sources ──
    const nameMap: Record<number, { name: string; source: string }> = {};

    // 2a. Taostats Identity API (highest priority)
    if (taostatsAvailable) {
      try {
        const idRes = await fetch("https://api.taostats.io/api/subnet/identity/v1", {
          headers: { Authorization: apiKey, Accept: "application/json" },
        });
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
        } else {
          console.warn("[name-sync] Identity API returned status:", idRes.status);
          await idRes.text();
        }
      } catch (e) {
        console.warn("[name-sync] Failed to fetch subnet identities:", e);
      }
    }

    // 2b. Taostats subnet/latest names (secondary)
    for (const s of subnets) {
      const nid = Number(s.netuid ?? s.subnet_id ?? s.id);
      if (isNaN(nid) || nameMap[nid]) continue;
      const fallbackName = s.name || s.subnet_name || null;
      if (isValidName(fallbackName)) {
        nameMap[nid] = { name: fallbackName!.trim(), source: "taostats_latest" };
      }
    }

    // 2c. SubnetAlpha fallback — always fetch to fill gaps
    const alphaNames = await fetchSubnetAlphaNames();
    let alphaFilled = 0;
    for (const [nidStr, name] of Object.entries(alphaNames)) {
      const nid = Number(nidStr);
      if (!nameMap[nid] && isValidName(name)) {
        nameMap[nid] = { name, source: "subnetalpha" };
        alphaFilled++;
      }
    }
    if (alphaFilled > 0) {
      console.log(`[name-sync] SubnetAlpha filled ${alphaFilled} additional names`);
    }

    console.log(`[name-sync] Total resolved names: ${Object.keys(nameMap).length}`);

    // ── 3. Get existing subnets from DB ──
    const { data: existing } = await sb.from("subnets").select("netuid, name, canonical_name, source_name");
    const existingMap = new Map<number, { name: string | null; canonical_name: string | null; source_name: string | null }>();
    for (const s of existing || []) {
      existingMap.set(s.netuid, { name: s.name, canonical_name: s.canonical_name, source_name: s.source_name });
    }

    // If Taostats was unavailable, we still update names for existing subnets using SubnetAlpha
    // Build a netuid list from DB if we have no Taostats data
    if (subnets.length === 0 && existing && existing.length > 0) {
      subnets = existing.map((s: any) => ({ netuid: s.netuid }));
      console.log(`[name-sync] Using ${subnets.length} existing DB subnets (Taostats unavailable)`);
    }

    const now = new Date().toISOString();
    let updated = 0;
    let namesUpdated = 0;
    let namesConflicts = 0;
    let errors = 0;

    for (const s of subnets) {
      const netuid = Number(s.netuid ?? s.subnet_id ?? s.id);
      if (isNaN(netuid)) continue;

      const resolved = nameMap[netuid];
      const newName = resolved?.name ?? null;
      const nameSource = resolved?.source ?? "unknown";
      const existingRow = existingMap.get(netuid);
      const isNew = !existingRow;

      if (isNew) {
        const { error } = await sb.from("subnets").insert({
          netuid,
          name: newName,
          canonical_name: newName,
          display_name: newName,
          source_name: nameSource,
          name_updated_at: newName ? now : null,
          first_seen_at: now,
          last_seen_at: now,
        });
        if (error) { console.error(`[name-sync] Insert subnet ${netuid} error:`, error); errors++; }
        await sb.from("events").insert({
          netuid, ts: now, type: "CREATED", severity: 1,
          evidence: { source: taostatsAvailable ? "taostats" : "subnetalpha", raw: s },
        });
      } else {
        const updatePayload: Record<string, any> = {};
        // Only update last_seen_at if Taostats was available (actual liveness check)
        if (taostatsAvailable) updatePayload.last_seen_at = now;

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

        if (Object.keys(updatePayload).length > 0) {
          const { error } = await sb.from("subnets").update(updatePayload).eq("netuid", netuid);
          if (error) { console.error(`[name-sync] Update subnet ${netuid} error:`, error); errors++; }
          else { updated++; }
        }
      }
    }

    const summary = {
      ok: true,
      taostats_available: taostatsAvailable,
      count: subnets.length,
      updated,
      names_updated: namesUpdated,
      names_conflicts: namesConflicts,
      errors,
      names_resolved: Object.keys(nameMap).length,
      subnetalpha_filled: alphaFilled,
    };
    console.log(`[name-sync] Done:`, JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[name-sync] sync-subnets error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
