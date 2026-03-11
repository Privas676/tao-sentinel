import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ═══════════════════════════════════════════════════
 *  RFC 8291 Web Push Encryption (aes128gcm)
 *  Using Web Crypto API — no external dependencies
 * ═══════════════════════════════════════════════════ */

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function base64urlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm));
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const input = new Uint8Array(info.length + 1);
  input.set(info, 0);
  input[info.length] = 1; // Counter = 1 (we only need one block)
  const output = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
  return output.slice(0, length);
}

/**
 * Encrypt a push payload per RFC 8291 (aes128gcm content encoding).
 * Returns the encrypted body ready to POST to the push endpoint.
 */
async function encryptPayload(
  payload: string,
  p256dhB64url: string,
  authB64url: string,
): Promise<Uint8Array> {
  // 1. Decode subscriber keys
  const authSecret = base64urlDecode(authB64url);         // 16 bytes
  const subscriberPubRaw = base64urlDecode(p256dhB64url); // 65 bytes (uncompressed P-256)

  // Import subscriber public key for ECDH
  const subscriberKey = await crypto.subtle.importKey(
    "raw", subscriberPubRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false, []
  );

  // 2. Generate ephemeral local key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, ["deriveBits"]
  );
  const localPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey)
  ); // 65 bytes

  // 3. ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: subscriberKey },
      localKeyPair.privateKey,
      256
    )
  ); // 32 bytes

  // 4. Derive IKM using RFC 8291 Section 3.4
  // PRK_key = HKDF-Extract(salt=auth_secret, ikm=shared_secret)
  const prkKey = await hkdfExtract(authSecret, sharedSecret);

  // key_info = "WebPush: info\0" + ua_public(65) + as_public(65)
  const keyInfoPrefix = new TextEncoder().encode("WebPush: info\0");
  const keyInfo = new Uint8Array(keyInfoPrefix.length + 65 + 65);
  keyInfo.set(keyInfoPrefix, 0);
  keyInfo.set(subscriberPubRaw, keyInfoPrefix.length);
  keyInfo.set(localPublicKeyRaw, keyInfoPrefix.length + 65);

  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // 5. Generate random salt for this message
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 6. Derive CEK and nonce per RFC 8188
  const prk = await hkdfExtract(salt, ikm);
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const cek = await hkdfExpand(prk, cekInfo, 16);
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  // 7. Pad plaintext: content + 0x02 delimiter (last record)
  const plaintextBytes = new TextEncoder().encode(payload);
  const padded = new Uint8Array(plaintextBytes.length + 1);
  padded.set(plaintextBytes, 0);
  padded[plaintextBytes.length] = 0x02; // Last record delimiter

  // 8. Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey(
    "raw", cek, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      padded
    )
  );

  // 9. Build aes128gcm body: header || encrypted_record
  // Header: salt(16) || rs(4) || idlen(1) || keyid(65)
  const rs = 4096; // Record size (standard)
  const header = new Uint8Array(16 + 4 + 1 + 65); // 86 bytes
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false); // big-endian
  header[20] = 65; // idlen = length of local public key
  header.set(localPublicKeyRaw, 21);

  const body = new Uint8Array(header.length + encrypted.length);
  body.set(header, 0);
  body.set(encrypted, header.length);

  return body;
}

/* ═══════════════════════════════════════════════════
 *  VAPID JWT signing (ECDSA P-256)
 * ═══════════════════════════════════════════════════ */

async function createVapidJwt(
  audience: string,
  subject: string,
  privateKeyB64url: string,
  publicKeyB64url: string
): Promise<string> {
  const pubRaw = base64urlDecode(publicKeyB64url);
  const x = base64urlEncode(pubRaw.slice(1, 33));
  const y = base64urlEncode(pubRaw.slice(33, 65));

  const jwk = { kty: "EC", crv: "P-256", x, y, d: privateKeyB64url };
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
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
    { name: "ECDSA", hash: "SHA-256" }, key,
    new TextEncoder().encode(input)
  );

  const sigBytes = new Uint8Array(sig);
  let rawSig: Uint8Array;
  if (sigBytes.length === 64) {
    rawSig = sigBytes;
  } else {
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
  if (dataLen === 33 && der[start] === 0) { start++; dataLen--; }
  const raw = new Uint8Array(32);
  const srcStart = dataLen > 32 ? dataLen - 32 : 0;
  const dstStart = 32 - Math.min(dataLen, 32);
  raw.set(der.slice(start + srcStart, start + dataLen), dstStart);
  return raw;
}

/* ═══════════════════════════════════════════════════
 *  Priority system
 * ═══════════════════════════════════════════════════ */

type Priority = 0 | 1 | 2 | 3;

const PRIORITY_MAP: Record<string, Priority> = {
  DEPEG_CONFIRMED: 0,
  RISK_OVERRIDE: 1,
  POSITION_URGENT: 1,
  CONFIDENCE_DROP: 2,
  DATA_UNSTABLE: 2,
  GO: 3,
  GO_SPECULATIVE: 3,
  EARLY: 3,
  BREAK: 3,
  EXIT_FAST: 3,
};

function getPriority(type: string): Priority {
  return PRIORITY_MAP[type] ?? 3;
}

/* ═══════════════════════════════════════════════════
 *  Event ID — stable hash for deduplication
 * ═══════════════════════════════════════════════════ */

function computeEventId(type: string, netuid: number | null, ts: string): string {
  const window = Math.floor(new Date(ts).getTime() / (15 * 60 * 1000));
  return `${type}:${netuid ?? "sys"}:${window}`;
}

/* ═══════════════════════════════════════════════════
 *  Pushable event filtering
 * ═══════════════════════════════════════════════════ */

const ENTRY_TYPES = new Set(["GO", "GO_SPECULATIVE", "EARLY"]);
const EXIT_TYPES = new Set(["BREAK", "EXIT_FAST"]);
const OVERRIDE_TYPES = new Set(["RISK_OVERRIDE"]);
const DEPEG_TYPES = new Set(["DEPEG_CONFIRMED"]);
const SYSTEM_ALERT_TYPES = new Set(["CONFIDENCE_DROP", "POSITION_URGENT"]);

function isPushableEvent(ev: { type: string | null; evidence: any }): boolean {
  if (!ev.type) return false;
  if (ENTRY_TYPES.has(ev.type) || EXIT_TYPES.has(ev.type)) return true;
  if (OVERRIDE_TYPES.has(ev.type)) return ev.evidence?.level === "CRITICAL";
  if (DEPEG_TYPES.has(ev.type)) return true;
  if (SYSTEM_ALERT_TYPES.has(ev.type)) return true;
  return false;
}

/* ═══════════════════════════════════════════════════
 *  Notification content builder
 * ═══════════════════════════════════════════════════ */

function eventToNotification(ev: { type: string; netuid: number | null; evidence: any }) {
  const e = ev.evidence || {};
  const sn = ev.netuid != null ? `SN-${ev.netuid}` : "Global";
  const reasons = (e.reasons as string[] || []).slice(0, 2).join(", ");

  if (ev.type === "CONFIDENCE_DROP") {
    return {
      title: `⚠️ CONFIANCE BASSE — ${e.avg_confidence ?? "?"}%`,
      body: reasons || `La confiance globale est descendue sous le seuil critique`,
      tag: `confidence-drop`,
    };
  }
  if (ev.type === "POSITION_URGENT") {
    return {
      title: `🚨 ACTION REQUISE — ${sn}`,
      body: reasons || `Votre position sur ${sn} nécessite une action immédiate`,
      tag: `position-urgent-${ev.netuid}`,
    };
  }
  if (ENTRY_TYPES.has(ev.type)) {
    const label = ev.type === "GO" ? "🟢 GO" : ev.type === "GO_SPECULATIVE" ? "🔶 SPÉCULATIF" : "🌱 EARLY";
    return { title: `${label} — ${sn}`, body: reasons || `Signal d'entrée détecté sur ${sn}`, tag: `state-${ev.netuid}` };
  }
  if (OVERRIDE_TYPES.has(ev.type)) {
    return { title: `🚨 OVERRIDE CRITIQUE — ${sn}`, body: reasons || `Override critique sur ${sn}`, tag: `override-${ev.netuid}` };
  }
  if (DEPEG_TYPES.has(ev.type)) {
    return { title: `🔴 DEPEG CONFIRMÉ — ${sn}`, body: reasons || `Depeg confirmé sur ${sn}`, tag: `depeg-${ev.netuid}` };
  }
  const label = ev.type === "EXIT_FAST" ? "⛔ EXIT FAST" : "⛔ ZONE CRITIQUE";
  return { title: `${label} — ${sn}`, body: reasons || `Signal de sortie critique sur ${sn}`, tag: `state-${ev.netuid}` };
}

/* ═══════════════════════════════════════════════════
 *  Send a single push notification (with encryption)
 * ═══════════════════════════════════════════════════ */

async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  config: { vapid_public_key: string; vapid_private_key: string },
): Promise<{ success: boolean; expired: boolean; status: number; error?: string }> {
  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;

    // VAPID JWT for authorization
    const jwt = await createVapidJwt(
      audience,
      "mailto:noreply@taosentinel.app",
      config.vapid_private_key,
      config.vapid_public_key,
    );

    // RFC 8291 encryption
    const encryptedBody = await encryptPayload(payload, sub.p256dh, sub.auth);

    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "86400",
        Urgency: "high",
        Authorization: `vapid t=${jwt}, k=${config.vapid_public_key}`,
      },
      body: encryptedBody,
    });
    await res.text(); // Consume body to prevent resource leak

    if (res.status === 200 || res.status === 201) {
      return { success: true, expired: false, status: res.status };
    }
    if (res.status === 410 || res.status === 404) {
      return { success: false, expired: true, status: res.status };
    }
    return { success: false, expired: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    console.error("[PUSH] sendPush error:", err);
    return { success: false, expired: false, status: 0, error: String(err) };
  }
}

/* ═══════════════════════════════════════════════════
 *  Main handler
 * ═══════════════════════════════════════════════════ */

const MAX_RETRIES = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const twoMinAgo = new Date(Date.now() - 2 * 60000).toISOString();
    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();

    const [{ data: events }, { data: allSignals }, { data: recentCriticals }] = await Promise.all([
      sb.from("events")
        .select("type, netuid, evidence, ts")
        .gte("ts", twoMinAgo)
        .in("type", ["GO", "GO_SPECULATIVE", "EARLY", "BREAK", "EXIT_FAST", "RISK_OVERRIDE", "DEPEG_CONFIRMED", "CONFIDENCE_DROP", "POSITION_URGENT"]),
      sb.from("signals")
        .select("netuid, confidence_pct, quality_score, state"),
      sb.from("events")
        .select("type, ts")
        .gte("ts", tenMinAgo)
        .in("type", ["BREAK", "EXIT_FAST"]),
    ]);

    let strategic = (events || []).filter(e => isPushableEvent(e));
    const signals = allSignals || [];
    const criticals = recentCriticals || [];

    /* ── KILL SWITCH ── */
    const killSwitchReasons: string[] = [];
    let safeModeActive = false;

    if (strategic.length > 10) {
      killSwitchReasons.push(`${strategic.length} events in 2min`);
      safeModeActive = true;
    }

    const totalSubnets = signals.length || 1;
    const uniqueCriticalNetuids = new Set(criticals.map((e: any) => e.netuid ?? 0));
    if (uniqueCriticalNetuids.size / totalSubnets >= 0.30) {
      killSwitchReasons.push(`${Math.round(uniqueCriticalNetuids.size / totalSubnets * 100)}% subnets critical`);
      safeModeActive = true;
    }

    const confidences = signals.map((s: any) => s.confidence_pct ?? 50);
    const avgConf = confidences.length > 0 ? confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length : 50;
    if (avgConf < 40) {
      killSwitchReasons.push(`Avg confidence ${Math.round(avgConf)}%`);
      safeModeActive = true;
    }

    if (safeModeActive) {
      const criticalOnly = strategic.filter(e => DEPEG_TYPES.has(e.type!));
      console.error(`[PUSH-KILL-SWITCH] SAFE MODE — ${killSwitchReasons.join("; ")} | Blocking ${strategic.length - criticalOnly.length}, allowing ${criticalOnly.length}`);
      if (criticalOnly.length === 0) {
        return new Response(JSON.stringify({
          ok: true, sent: 0, reason: "kill_switch_safe_mode",
          triggers: killSwitchReasons, blocked: strategic.length,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      strategic = criticalOnly;
    }

    /* ── Sort by priority (P0 first) ── */
    strategic.sort((a, b) => getPriority(a.type!) - getPriority(b.type!));

    /* ── Compute eventIds and deduplicate ── */
    type PushEvent = typeof strategic[0] & { eventId: string; priority: Priority };
    const deduped = new Map<string, PushEvent>();
    for (const ev of strategic) {
      const eventId = computeEventId(ev.type!, ev.netuid, ev.ts);
      if (!deduped.has(eventId)) {
        deduped.set(eventId, { ...ev, eventId, priority: getPriority(ev.type!) });
      }
    }

    if (deduped.size === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no_strategic_events" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    /* ── Get subscribers + VAPID keys ── */
    const [{ data: subs }, { data: config }] = await Promise.all([
      sb.from("push_subscriptions").select("id, endpoint, p256dh, auth"),
      sb.from("push_config").select("vapid_public_key, vapid_private_key").eq("id", 1).maybeSingle(),
    ]);

    if (!subs?.length || !config) {
      return new Response(JSON.stringify({
        ok: true, sent: 0, reason: !subs?.length ? "no_subscribers" : "no_vapid_keys",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[PUSH] Processing ${deduped.size} events for ${subs.length} subscribers`);

    /* ── Also process pending retries ── */
    const { data: retryRows } = await sb.from("push_log")
      .select("id, event_id, endpoint, payload, retry_count")
      .eq("status", "retry")
      .lt("retry_count", MAX_RETRIES)
      .order("priority", { ascending: true })
      .limit(50);

    /* ── Send loop ── */
    let sent = 0;
    let failed = 0;
    let skippedDedup = 0;
    const expiredEndpoints: string[] = [];

    for (const [, ev] of deduped) {
      const notification = eventToNotification(ev as any);
      const payload = JSON.stringify(notification);

      for (const sub of subs) {
        // Check dedup: try insert, ON CONFLICT skip
        const { error: insertErr } = await sb.from("push_log").insert({
          event_id: ev.eventId,
          priority: ev.priority,
          event_type: ev.type!,
          netuid: ev.netuid,
          subscription_id: sub.id,
          endpoint: sub.endpoint,
          status: "pending",
          payload: notification,
        });

        if (insertErr) {
          if (insertErr.code === "23505") {
            skippedDedup++;
            continue;
          }
          console.warn(`[PUSH-LOG] Insert error: ${insertErr.message}`);
        }

        const result = await sendPush(sub, payload, config);
        console.log(`[PUSH] ${ev.type} → ${sub.endpoint.slice(0, 50)}… = ${result.success ? "OK" : `FAIL(${result.status})`}`);

        if (result.success) {
          sent++;
          await sb.from("push_log")
            .update({ status: "sent", http_status: result.status, sent_at: new Date().toISOString() })
            .eq("event_id", ev.eventId).eq("endpoint", sub.endpoint);
        } else if (result.expired) {
          expiredEndpoints.push(sub.endpoint);
          await sb.from("push_log")
            .update({ status: "expired", http_status: result.status })
            .eq("event_id", ev.eventId).eq("endpoint", sub.endpoint);
        } else {
          failed++;
          await sb.from("push_log")
            .update({
              status: "retry",
              http_status: result.status,
              error_message: result.error,
              retry_count: 1,
              last_retry_at: new Date().toISOString(),
            })
            .eq("event_id", ev.eventId).eq("endpoint", sub.endpoint);
        }
      }
    }

    /* ── Process retries ── */
    let retried = 0;
    for (const row of retryRows || []) {
      const sub = subs.find(s => s.endpoint === row.endpoint);
      if (!sub) continue;

      const result = await sendPush(sub, JSON.stringify(row.payload), config);

      if (result.success) {
        retried++;
        await sb.from("push_log")
          .update({ status: "sent", http_status: result.status, sent_at: new Date().toISOString() })
          .eq("id", row.id);
      } else if (result.expired) {
        expiredEndpoints.push(sub.endpoint);
        await sb.from("push_log")
          .update({ status: "expired", http_status: result.status })
          .eq("id", row.id);
      } else {
        const newCount = (row.retry_count || 0) + 1;
        await sb.from("push_log")
          .update({
            status: newCount >= MAX_RETRIES ? "failed" : "retry",
            http_status: result.status,
            error_message: result.error,
            retry_count: newCount,
            last_retry_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }
    }

    /* ── Cleanup expired subscriptions ── */
    const uniqueExpired = [...new Set(expiredEndpoints)];
    if (uniqueExpired.length > 0) {
      await sb.from("push_subscriptions").delete().in("endpoint", uniqueExpired);
      console.log(`Cleaned ${uniqueExpired.length} expired subscriptions`);
    }

    console.log(`[PUSH] sent=${sent} retried=${retried} failed=${failed} dedup_skipped=${skippedDedup} events=${deduped.size} subs=${subs.length}`);

    return new Response(JSON.stringify({
      ok: true, sent, retried, failed,
      dedupSkipped: skippedDedup,
      events: deduped.size,
      killSwitch: safeModeActive ? killSwitchReasons : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("send-push error:", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
