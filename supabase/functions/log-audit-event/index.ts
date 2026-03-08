import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Parse & validate body
    const body = await req.json();
    const { entries } = body;

    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 50) {
      return new Response(
        JSON.stringify({ error: "entries must be an array of 1-50 items" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const VALID_EVENT_TYPES = ["SCORING_CYCLE", "ALERT_FIRED", "STATE_CHANGE", "KILL_SWITCH"];

    const rows = entries.map((e: Record<string, unknown>) => {
      const eventType = String(e.event_type ?? "");
      if (!VALID_EVENT_TYPES.includes(eventType)) {
        throw new Error(`Invalid event_type: ${eventType}`);
      }
      return {
        engine_version: String(e.engine_version ?? "v4"),
        event_type: eventType,
        snapshot_ids: Array.isArray(e.snapshot_ids) ? e.snapshot_ids : [],
        subnet_count: typeof e.subnet_count === "number" ? e.subnet_count : null,
        netuid: typeof e.netuid === "number" ? e.netuid : null,
        inputs: (e.inputs && typeof e.inputs === "object") ? e.inputs : {},
        outputs: (e.outputs && typeof e.outputs === "object") ? e.outputs : {},
        top_factors: Array.isArray(e.top_factors) ? e.top_factors : [],
        decision_reason: e.decision_reason ? String(e.decision_reason) : null,
        data_confidence: typeof e.data_confidence === "number" ? e.data_confidence : null,
        alignment_status: e.alignment_status ? String(e.alignment_status) : null,
        kill_switch_active: Boolean(e.kill_switch_active),
        kill_switch_triggers: Array.isArray(e.kill_switch_triggers) ? e.kill_switch_triggers : [],
      };
    });

    // 3. Write with service_role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { error: insertErr } = await adminClient.from("audit_log").insert(rows);

    if (insertErr) {
      console.error("[log-audit-event] Insert failed:", insertErr.message);
      return new Response(
        JSON.stringify({ error: "Write failed", detail: insertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, count: rows.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[log-audit-event] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
