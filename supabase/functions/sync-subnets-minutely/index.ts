import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Names we treat as "no real name" */
const INVALID_NAMES = new Set(["Unknown", "Pending", "", "null", "undefined"]);

function isValidName(n: unknown): n is string {
  return typeof n === "string" && n.trim().length > 0 && !INVALID_NAMES.has(n.trim());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("TAOSTATS_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // ── 1. Fetch subnet list from Taostats ──
    const res = await fetch("https://api.taostats.io/api/subnet/latest/v1", {
      headers: { Authorization: apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Taostats API error: ${res.status}`);
    const json = await res.json();
    const subnets = Array.isArray(json) ? json : json.data || json.subnets || [];

    // ── 2. Fetch subnet identities (primary name source) ──
    const nameMap: Record<number, { name: string; source: string }> = {};
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
        console.log(`[name-sync] Loaded ${Object.keys(nameMap).length} names from identity API`);
      } else {
        console.warn("[name-sync] Identity API returned status:", idRes.status);
        await idRes.text();
      }
    } catch (e) {
      console.warn("[name-sync] Failed to fetch subnet identities:", e);
    }

    // ── 3. Fallback names from subnet/latest response ──
    for (const s of subnets) {
      const nid = Number(s.netuid ?? s.subnet_id ?? s.id);
      if (isNaN(nid) || nameMap[nid]) continue;
      const fallbackName = s.name || s.subnet_name || null;
      if (isValidName(fallbackName)) {
        nameMap[nid] = { name: fallbackName!.trim(), source: "taostats_latest" };
      }
    }
    console.log(`[name-sync] Total names after fallback: ${Object.keys(nameMap).length}`);

    // ── 4. Get existing subnets from DB ──
    const { data: existing } = await sb.from("subnets").select("netuid, name, canonical_name, source_name");
    const existingMap = new Map<number, { name: string | null; canonical_name: string | null; source_name: string | null }>();
    for (const s of existing || []) {
      existingMap.set(s.netuid, { name: s.name, canonical_name: s.canonical_name, source_name: s.source_name });
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
        // ── INSERT new subnet ──
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
          evidence: { source: "taostats", raw: s },
        });
      } else {
        // ── UPDATE existing subnet ──
        const updatePayload: Record<string, any> = { last_seen_at: now };
        const oldName = existingRow!.canonical_name || existingRow!.name;
        const oldSource = existingRow!.source_name;

        // Determine if name needs updating
        const oldNameInvalid = !isValidName(oldName);
        const newNameValid = isValidName(newName);

        if (newNameValid) {
          if (oldNameInvalid || oldName !== newName) {
            // Log conflict if old name existed and differs
            if (!oldNameInvalid && oldName !== newName) {
              console.log(`[name-sync] CONFLICT netuid=${netuid}: "${oldName}" (${oldSource}) → "${newName}" (${nameSource})`);
              namesConflicts++;
            }
            // Overwrite with Taostats name (primary source)
            updatePayload.name = newName;
            updatePayload.canonical_name = newName;
            updatePayload.display_name = newName;
            updatePayload.source_name = nameSource;
            updatePayload.name_updated_at = now;
            namesUpdated++;
          }
        }

        const { error } = await sb.from("subnets").update(updatePayload).eq("netuid", netuid);
        if (error) { console.error(`[name-sync] Update subnet ${netuid} error:`, error); errors++; }
        else { updated++; }
      }
    }

    const summary = {
      ok: true,
      count: subnets.length,
      updated,
      names_updated: namesUpdated,
      names_conflicts: namesConflicts,
      errors,
      names_resolved: Object.keys(nameMap).length,
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
