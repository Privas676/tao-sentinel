import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * VAPID JWT signing for Web Push
 * Uses ECDSA P-256 with the stored VAPID private key
 */
async function createVapidJwt(
  audience: string,
  subject: string,
  privateKeyB64url: string,
  publicKeyB64url: string
): Promise<string> {
  // Decode private key from base64url
  const privBytes = Uint8Array.from(
    atob(privateKeyB64url.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );

  // Import as ECDSA P-256 private key via JWK
  const pubRawB64 = publicKeyB64url.replace(/-/g, "+").replace(/_/g, "/");
  // We need x and y from public key (65 bytes raw: 0x04 + 32x + 32y)
  const pubRaw = Uint8Array.from(atob(pubRawB64 + "=".repeat((4 - pubRawB64.length % 4) % 4)), c => c.charCodeAt(0));
  const x = btoa(String.fromCharCode(...pubRaw.slice(1, 33))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const y = btoa(String.fromCharCode(...pubRaw.slice(33, 65))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x, y,
    d: privateKeyB64url,
  };

  const key = await crypto.subtle.importKey(
    "jwk", jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: now + 86400, sub: subject };

  const b64url = (obj: unknown) => {
    const json = JSON.stringify(obj);
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const input = `${b64url(header)}.${b64url(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input)
  );

  // Convert DER to raw r||s (64 bytes)
  const sigBytes = new Uint8Array(sig);
  let rawSig: Uint8Array;
  if (sigBytes.length === 64) {
    rawSig = sigBytes;
  } else {
    // DER decode
    const r = derIntegerToRaw(sigBytes, 3);
    const sOffset = 3 + sigBytes[3] + 2;
    const s = derIntegerToRaw(sigBytes, sOffset);
    rawSig = new Uint8Array(64);
    rawSig.set(r, 0);
    rawSig.set(s, 32);
  }

  const sigB64 = btoa(String.fromCharCode(...rawSig))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return `${input}.${sigB64}`;
}

function derIntegerToRaw(der: Uint8Array, offset: number): Uint8Array {
  const len = der[offset + 1];
  let start = offset + 2;
  let dataLen = len;
  // Skip leading zero padding
  if (dataLen === 33 && der[start] === 0) { start++; dataLen--; }
  const raw = new Uint8Array(32);
  const srcStart = dataLen > 32 ? dataLen - 32 : 0;
  const dstStart = 32 - Math.min(dataLen, 32);
  raw.set(der.slice(start + srcStart, start + dataLen), dstStart);
  return raw;
}

/** Strategic transition types that trigger push notifications */
const ENTRY_TYPES = new Set(["GO", "GO_SPECULATIVE", "EARLY"]);
const EXIT_TYPES = new Set(["BREAK", "EXIT_FAST"]);

function isStrategicEvent(type: string | null): boolean {
  if (!type) return false;
  return ENTRY_TYPES.has(type) || EXIT_TYPES.has(type);
}

function eventToNotification(ev: { type: string; netuid: number; evidence: any }) {
  const e = ev.evidence || {};
  const sn = `SN-${ev.netuid}`;
  const reasons = (e.reasons as string[] || []).slice(0, 2).join(", ");

  if (ENTRY_TYPES.has(ev.type)) {
    const label = ev.type === "GO" ? "🟢 GO" : ev.type === "GO_SPECULATIVE" ? "🔶 SPÉCULATIF" : "🌱 EARLY";
    return {
      title: `${label} — ${sn}`,
      body: reasons || `Signal d'entrée détecté sur ${sn}`,
      tag: `state-${ev.netuid}`,
    };
  }

  const label = ev.type === "EXIT_FAST" ? "⛔ EXIT FAST" : "⛔ ZONE CRITIQUE";
  return {
    title: `${label} — ${sn}`,
    body: reasons || `Signal de sortie critique sur ${sn}`,
    tag: `state-${ev.netuid}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get recent strategic events (last 2 minutes — this runs every minute)
    const twoMinAgo = new Date(Date.now() - 2 * 60000).toISOString();
    const { data: events } = await sb.from("events")
      .select("type, netuid, evidence, ts")
      .gte("ts", twoMinAgo)
      .in("type", ["GO", "GO_SPECULATIVE", "EARLY", "BREAK", "EXIT_FAST"]);

    const strategic = (events || []).filter(e => isStrategicEvent(e.type));

    // ── KILL SWITCH: Distribution instability guard ──
    // If too many strategic events fire simultaneously, it likely indicates
    // a compressed/extreme distribution anomaly — suppress notifications.
    const KILL_SWITCH_THRESHOLD = 10; // >10 strategic events in 2min = anomaly
    if (strategic.length > KILL_SWITCH_THRESHOLD) {
      console.error(`[PUSH-KILL-SWITCH] ${strategic.length} strategic events in 2min — distribution likely unstable, suppressing notifications`);
      return new Response(JSON.stringify({
        ok: true, sent: 0,
        reason: "kill_switch_distribution_unstable",
        eventCount: strategic.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (strategic.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no_strategic_events" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all push subscriptions
    const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth");
    if (!subs?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no_subscribers" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get VAPID keys
    const { data: config } = await sb.from("push_config")
      .select("vapid_public_key, vapid_private_key")
      .eq("id", 1)
      .maybeSingle();

    if (!config) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no_vapid_keys" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send notifications for each strategic event to all subscribers
    let sent = 0;
    let failed = 0;
    const expiredEndpoints: string[] = [];

    for (const ev of strategic) {
      const notification = eventToNotification(ev as any);
      const payload = JSON.stringify(notification);

      for (const sub of subs) {
        try {
          const url = new URL(sub.endpoint);
          const audience = `${url.protocol}//${url.host}`;

          const jwt = await createVapidJwt(
            audience,
            "mailto:noreply@taosentinel.app",
            config.vapid_private_key,
            config.vapid_public_key
          );

          const res = await fetch(sub.endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "TTL": "86400",
              "Authorization": `vapid t=${jwt}, k=${config.vapid_public_key}`,
            },
            body: payload,
          });
          await res.text(); // consume body

          if (res.status === 201 || res.status === 200) {
            sent++;
          } else if (res.status === 410 || res.status === 404) {
            // Subscription expired
            expiredEndpoints.push(sub.endpoint);
          } else {
            console.warn(`Push failed for ${sub.endpoint}: ${res.status}`);
            failed++;
          }
        } catch (err) {
          console.error(`Push error for ${sub.endpoint}:`, err);
          failed++;
        }
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      await sb.from("push_subscriptions").delete().in("endpoint", expiredEndpoints);
      console.log(`Cleaned ${expiredEndpoints.length} expired push subscriptions`);
    }

    console.log(`Push notifications: ${sent} sent, ${failed} failed, ${strategic.length} events, ${subs.length} subscribers`);

    return new Response(JSON.stringify({ ok: true, sent, failed, events: strategic.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-push error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
