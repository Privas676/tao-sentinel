import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

// Extend ServiceWorkerRegistration for Push API (not in all TS libs)
declare global {
  interface ServiceWorkerRegistration {
    pushManager: PushManager;
  }
}

type PushState = "unsupported" | "denied" | "prompt" | "subscribed" | "unsubscribed" | "loading";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

/** Promise that rejects after `ms` milliseconds */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms)
    ),
  ]);
}

export function usePushNotifications() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Detect actual state on mount and when permission changes
  const detectState = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    if (typeof Notification !== "undefined" && Notification.permission === "denied") {
      setState("denied");
      return;
    }

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      setState("unsubscribed");
      return;
    }

    // Permission is "granted" — check if actively subscribed
    try {
      const reg = await withTimeout(navigator.serviceWorker.ready, 5000, "SW ready");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "subscribed" : "unsubscribed");
    } catch (err) {
      console.warn("[Push] detectState error:", err);
      setState("unsubscribed");
    }
  }, []);

  useEffect(() => {
    detectState();
  }, [detectState]);

  const subscribe = useCallback(async () => {
    if (!user) {
      setError("Sign in required to enable push notifications");
      return;
    }

    setState("loading");
    setError(null);

    try {
      console.log("[Push] Starting subscription flow…");

      // 1. Refresh session to get a valid token
      const { data: { session } } = await supabase.auth.refreshSession();
      if (!session?.access_token) throw new Error("Session expired — please sign in again");
      console.log("[Push] Session refreshed ✓");

      // 2. Register the push service worker (with timeout)
      let reg: ServiceWorkerRegistration;
      try {
        reg = await withTimeout(
          navigator.serviceWorker.register("/sw-push.js", { scope: "/" }),
          10000,
          "SW register"
        );
        console.log("[Push] SW registered ✓");
      } catch (regErr) {
        throw new Error(`Service Worker registration failed: ${regErr instanceof Error ? regErr.message : regErr}`);
      }

      // 3. Wait for SW to be ready (with timeout)
      try {
        reg = await withTimeout(navigator.serviceWorker.ready, 10000, "SW ready");
        console.log("[Push] SW ready ✓");
      } catch {
        throw new Error("Service Worker not ready — try reloading the page");
      }

      // 4. Get VAPID public key from edge function
      console.log("[Push] Fetching VAPID key…");
      const { data: vapidData, error: vapidErr } = await supabase.functions.invoke("manage-push", {
        body: { action: "get-vapid-key" },
      });
      if (vapidErr) throw new Error(`VAPID key error: ${vapidErr.message}`);
      const vapidPublicKey = vapidData?.vapidPublicKey;
      if (!vapidPublicKey) throw new Error("No VAPID key returned from server");
      console.log("[Push] VAPID key received ✓");

      // 5. Request notification permission
      const permission = await Notification.requestPermission();
      console.log("[Push] Permission result:", permission);
      if (permission !== "granted") {
        setState("denied");
        setError(
          permission === "denied"
            ? "Permission refusée. Ouvrez les paramètres de votre navigateur pour autoriser les notifications."
            : "Permission non accordée."
        );
        return;
      }

      // 6. Clean up any stale subscription before creating new one
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        console.log("[Push] Cleaning stale subscription…");
        try { await existingSub.unsubscribe(); } catch { /* ignore */ }
      }

      // 7. Create fresh push subscription
      console.log("[Push] Subscribing to push manager…");
      let subscription: PushSubscription;
      try {
        subscription = await withTimeout(
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
          }),
          15000,
          "pushManager.subscribe"
        );
      } catch (subErr) {
        throw new Error(`Push subscribe failed: ${subErr instanceof Error ? subErr.message : subErr}`);
      }
      console.log("[Push] Push subscription created ✓", subscription.endpoint.slice(0, 60));

      const subJson = subscription.toJSON();
      if (!subJson.keys?.p256dh || !subJson.keys?.auth) {
        throw new Error("Push subscription missing encryption keys");
      }

      // 8. Store subscription in backend (with auth)
      console.log("[Push] Persisting subscription to backend…");
      const { data: persistData, error: subErr } = await supabase.functions.invoke("manage-push", {
        body: {
          action: "subscribe",
          endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
      });

      if (subErr) {
        throw new Error(`Backend persist error: ${subErr.message}`);
      }

      // Check if the response itself contains an error
      if (persistData?.error) {
        throw new Error(`Backend error: ${persistData.error}`);
      }

      console.log("[Push] Subscription persisted ✓");
      setState("subscribed");
      setError(null);
    } catch (err) {
      console.error("[Push] Subscribe error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Re-detect actual state
      await detectState();
    }
  }, [user, detectState]);

  const unsubscribe = useCallback(async () => {
    setState("loading");
    setError(null);

    try {
      const reg = await withTimeout(navigator.serviceWorker.ready, 5000, "SW ready");
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();

        await supabase.functions.invoke("manage-push", {
          body: { action: "unsubscribe", endpoint },
        });
      }

      setState("unsubscribed");
    } catch (err) {
      console.error("[Push] Unsubscribe error:", err);
      setError(err instanceof Error ? err.message : String(err));
      await detectState();
    }
  }, [detectState]);

  const sendTest = useCallback(async () => {
    if (state !== "subscribed") {
      setTestResult("not_subscribed");
      return;
    }
    setTestResult("sending");
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.refreshSession();
      if (!session?.access_token) throw new Error("Session expired");

      const { data, error: testErr } = await supabase.functions.invoke("manage-push", {
        body: { action: "send-test" },
      });

      if (testErr) throw new Error(testErr.message);
      if (data?.error) throw new Error(data.error);
      setTestResult(data?.ok ? "sent" : "failed");

      // Auto-clear after 8s
      setTimeout(() => setTestResult(null), 8000);
    } catch (err) {
      console.error("[Push] Test error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setTestResult("failed");
      setTimeout(() => setTestResult(null), 8000);
    }
  }, [state]);

  return { state, error, testResult, subscribe, unsubscribe, sendTest, detectState };
}
