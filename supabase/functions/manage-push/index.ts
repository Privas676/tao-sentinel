import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_ACTIONS = ["get-vapid-key", "subscribe", "unsubscribe", "send-test"];

/**
 * Generate VAPID key pair using Web Crypto API (P-256 / ECDSA)
 */
async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  const publicKey = btoa(String.fromCharCode(...new Uint8Array(pubRaw)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const privateKey = privJwk.d!;

  return { publicKey, privateKey };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // Validate action parameter
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET or CREATE VAPID keys ──
    if (action === "get-vapid-key") {
      let { data: config } = await sb.from("push_config").select("vapid_public_key").eq("id", 1).maybeSingle();

      if (!config) {
        const keys = await generateVapidKeys();
        const { error } = await sb.from("push_config").insert({
          id: 1,
          vapid_public_key: keys.publicKey,
          vapid_private_key: keys.privateKey,
        });
        if (error) throw error;
        config = { vapid_public_key: keys.publicKey };
      }

      return new Response(JSON.stringify({ vapidPublicKey: config.vapid_public_key }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Helper: authenticate user for subscribe/unsubscribe ──
    async function authenticateUser(req: Request): Promise<{ userId: string } | Response> {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized — sign in required" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized — invalid session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return { userId: user.id };
    }

    // ── SUBSCRIBE (requires auth) ──
    if (action === "subscribe") {
      const authResult = await authenticateUser(req);
      if (authResult instanceof Response) return authResult;

      const { endpoint, p256dh, auth } = body;

      // Validate endpoint is a valid HTTPS URL
      if (!endpoint || typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
        return new Response(JSON.stringify({ error: "Invalid endpoint: must be an HTTPS URL" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (endpoint.length > 2048) {
        return new Response(JSON.stringify({ error: "Endpoint URL too long" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Validate subscription keys
      if (!p256dh || typeof p256dh !== "string" || p256dh.length < 20 || p256dh.length > 512) {
        return new Response(JSON.stringify({ error: "Invalid p256dh key" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!auth || typeof auth !== "string" || auth.length < 10 || auth.length > 512) {
        return new Response(JSON.stringify({ error: "Invalid auth key" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await sb.from("push_subscriptions").upsert(
        { endpoint, p256dh, auth, user_id: authResult.userId },
        { onConflict: "endpoint" }
      );
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── UNSUBSCRIBE (requires auth) ──
    if (action === "unsubscribe") {
      const authResult = await authenticateUser(req);
      if (authResult instanceof Response) return authResult;

      const { endpoint } = body;
      if (!endpoint || typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
        return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Only delete if owned by authenticated user
      await sb.from("push_subscriptions").delete()
        .eq("endpoint", endpoint)
        .eq("user_id", authResult.userId);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SEND TEST PUSH (requires authentication) ──
    if (action === "send-test") {
      // Verify caller is authenticated
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
      if (userErr || !user) {
        console.error("manage-push auth error:", userErr?.message);
        return new Response(JSON.stringify({ error: "Unauthorized - please sign in first" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userId = user.id;

      // Insert a test GO event, then invoke send-push-notifications
      const { error: evErr } = await sb.from("events").insert({
        type: "GO",
        netuid: 33,
        severity: 3,
        evidence: { reasons: ["🧪 Test push notification"], test: true },
      });
      if (evErr) throw evErr;

      // Call send-push-notifications
      const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notifications`;
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ force: true }),
      });
      const result = await res.json();

      return new Response(JSON.stringify({ ok: true, pushResult: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("manage-push error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
