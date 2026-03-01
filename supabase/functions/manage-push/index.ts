import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // ── SUBSCRIBE ──
    if (action === "subscribe") {
      const { endpoint, p256dh, auth } = body;
      if (!endpoint || !p256dh || !auth) {
        return new Response(JSON.stringify({ error: "Missing subscription fields" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await sb.from("push_subscriptions").upsert(
        { endpoint, p256dh, auth },
        { onConflict: "endpoint" }
      );
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── UNSUBSCRIBE ──
    if (action === "unsubscribe") {
      const { endpoint } = body;
      if (!endpoint) {
        return new Response(JSON.stringify({ error: "Missing endpoint" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("manage-push error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
