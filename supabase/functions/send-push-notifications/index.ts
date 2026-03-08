import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ═══════════════════════════════════════════════════
 *  VAPID JWT signing (ECDSA P-256)
 * ═══════════════════════════════════════════════════ */

async function createVapidJwt(
  audience: string,
  subject: string,
  privateKeyB64url: string,
  publicKeyB64url: string
): Promise<string> {
  const pubRawB64 = publicKeyB64url.replace(/-/g, "+").replace(/_/g, "/");
  const pubRaw = Uint8Array.from(atob(pubRawB64 + "=".repeat((4 - pubRawB64.length % 4) % 4)), c => c.charCodeAt(0));
  const x = btoa(String.fromCharCode(...pubRaw.slice(1, 33))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const y = btoa(String.fromCharCode(...pubRaw.slice(33, 65))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwk = { kty: "EC", crv: "P-256", x, y, d: privateKeyB64url };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: now + 86400, sub: subject };

  const b64url = (obj: unknown) => {
    const json = JSON.stringify(obj);
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const input = `${b64url(header)}.${b64url(payload)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));

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

  const sigB64 = btoa(String.fromCharCode(...rawSig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  DEPEG_CONFIRMED: 0,     // P0: depeg confirmed
  RISK_OVERRIDE: 1,       // P1: override critical
  POSITION_URGENT: 1,     // P1: position needs immediate action
  CONFIDENCE_DROP: 2,     // P2: global confidence alert
  DATA_UNSTABLE: 2,       // P2: system alert
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
 *  Format: {type}:{netuid}:{15min-window}
 *  Same event in same 15-min window = same eventId
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

function eventToNotification(ev: { type: string; netuid: number; evidence: any }) {
  const e = ev.evidence || {};
  const sn = `SN-${ev.netuid}`;
  const reasons = (e.reasons as string[] || []).slice(0, 2).join(", ");

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
        .in("type", ["GO", "GO_SPECULATIVE", "EARLY", "BREAK", "EXIT_FAST", "RISK_OVERRIDE", "DEPEG_CONFIRMED"]),
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
      // Only allow P0 (DEPEG_CONFIRMED) through
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
          // Unique constraint violation = already sent/logged
          if (insertErr.code === "23505") {
            skippedDedup++;
            continue;
          }
          console.warn(`[PUSH-LOG] Insert error: ${insertErr.message}`);
        }

        const result = await sendPush(sub, payload, config);

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

/* ═══════════════════════════════════════════════════
 *  Send a single push notification
 * ═══════════════════════════════════════════════════ */

async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  config: { vapid_public_key: string; vapid_private_key: string },
): Promise<{ success: boolean; expired: boolean; status: number; error?: string }> {
  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;

    const jwt = await createVapidJwt(
      audience,
      "mailto:noreply@taosentinel.app",
      config.vapid_private_key,
      config.vapid_public_key,
    );

    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Authorization: `vapid t=${jwt}, k=${config.vapid_public_key}`,
      },
      body: payload,
    });
    await res.text();

    if (res.status === 200 || res.status === 201) {
      return { success: true, expired: false, status: res.status };
    }
    if (res.status === 410 || res.status === 404) {
      return { success: false, expired: true, status: res.status };
    }
    return { success: false, expired: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, expired: false, status: 0, error: String(err) };
  }
}
