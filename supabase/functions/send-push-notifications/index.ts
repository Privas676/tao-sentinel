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
/** RISK_OVERRIDE is only pushed for Critical-level (evidence.level === "CRITICAL") */
const OVERRIDE_TYPES = new Set(["RISK_OVERRIDE"]);
/** DEPEG events: only DEPEG_CONFIRMED triggers push */
const DEPEG_TYPES = new Set(["DEPEG_CONFIRMED"]);

function isStrategicEvent(type: string | null): boolean {
  if (!type) return false;
  return ENTRY_TYPES.has(type) || EXIT_TYPES.has(type);
}

function isPushableEvent(ev: { type: string | null; evidence: any }): boolean {
  if (!ev.type) return false;
  if (isStrategicEvent(ev.type)) return true;
  // RISK_OVERRIDE: only push if Critical level
  if (OVERRIDE_TYPES.has(ev.type)) {
    return ev.evidence?.level === "CRITICAL";
  }
  // DEPEG_CONFIRMED: always push (high confidence, tick-confirmed)
  if (DEPEG_TYPES.has(ev.type)) return true;
  return false;
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

  if (OVERRIDE_TYPES.has(ev.type)) {
    return {
      title: `🚨 OVERRIDE CRITIQUE — ${sn}`,
      body: reasons || `Override de risque critique sur ${sn} (score: ${e.overrideScore ?? '?'})`,
      tag: `override-${ev.netuid}`,
    };
  }

  if (DEPEG_TYPES.has(ev.type)) {
    return {
      title: `🔴 DEPEG CONFIRMÉ — ${sn}`,
      body: reasons || `Depeg confirmé sur ${sn} (probabilité: ${e.probability ?? '?'}%)`,
      tag: `depeg-${ev.netuid}`,
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
    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();

    const [{ data: events }, { data: allSignals }, { data: recentCriticals }] = await Promise.all([
      sb.from("events")
        .select("type, netuid, evidence, ts")
        .gte("ts", twoMinAgo)
        .in("type", ["GO", "GO_SPECULATIVE", "EARLY", "BREAK", "EXIT_FAST", "RISK_OVERRIDE", "DEPEG_CONFIRMED"]),
      sb.from("signals")
        .select("netuid, confidence_pct, quality_score, state"),
      sb.from("events")
        .select("type, ts")
        .gte("ts", tenMinAgo)
        .in("type", ["BREAK", "EXIT_FAST"]),
    ]);

    const strategic = (events || []).filter(e => isPushableEvent(e));
    const signals = allSignals || [];
    const criticals = recentCriticals || [];

    // ══════════════════════════════════════
    //   KILL SWITCH — Multi-trigger evaluation
    // ══════════════════════════════════════

    const killSwitchReasons: string[] = [];
    let safeModeActive = false;

    // Trigger 1: >10 strategic events in 2min (distribution anomaly)
    const VOLUME_THRESHOLD = 10;
    if (strategic.length > VOLUME_THRESHOLD) {
      killSwitchReasons.push(`${strategic.length} events in 2min (volume anomaly)`);
      safeModeActive = true;
    }

    // Trigger 2: >30% subnets in BREAK/EXIT in 10min window
    const totalSubnets = signals.length || 1;
    const uniqueCriticalNetuids = new Set(criticals.map((e: any) => e.netuid ?? 0));
    const criticalPct = uniqueCriticalNetuids.size / totalSubnets;
    if (criticalPct >= 0.30) {
      killSwitchReasons.push(`${Math.round(criticalPct * 100)}% subnets critical in 10min`);
      safeModeActive = true;
    }

    // Trigger 3: Average confidence too low across fleet
    const confidences = signals.map((s: any) => s.confidence_pct ?? 50);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length
      : 50;
    if (avgConfidence < 40) {
      killSwitchReasons.push(`Avg fleet confidence ${Math.round(avgConfidence)}% < 40%`);
      safeModeActive = true;
    }

    // Trigger 4: Average quality score very low
    const qualities = signals.map((s: any) => s.quality_score ?? 50);
    const avgQuality = qualities.length > 0
      ? qualities.reduce((a: number, b: number) => a + b, 0) / qualities.length
      : 50;
    if (avgQuality < 30) {
      killSwitchReasons.push(`Avg fleet quality ${Math.round(avgQuality)}% < 30%`);
      safeModeActive = true;
    }

    // ── Apply Kill Switch ──
    if (safeModeActive) {
      // Filter: only allow DEPEG_CONFIRMED through
      const criticalOnly = strategic.filter(e => DEPEG_TYPES.has(e.type!));
      console.error(`[PUSH-KILL-SWITCH] SAFE MODE — ${killSwitchReasons.join("; ")} | Blocking ${strategic.length - criticalOnly.length} events, allowing ${criticalOnly.length} critical`);

      if (criticalOnly.length === 0) {
        return new Response(JSON.stringify({
          ok: true, sent: 0,
          reason: "kill_switch_safe_mode",
          triggers: killSwitchReasons,
          blocked: strategic.length,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Replace strategic with only critical events
      strategic.length = 0;
      strategic.push(...criticalOnly);
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
