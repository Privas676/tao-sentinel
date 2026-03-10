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

    // Check current permission
    if (typeof Notification !== "undefined" && Notification.permission === "denied") {
      setState("denied");
      return;
    }

    // If permission is "default" (not yet asked), show as unsubscribed
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      setState("unsubscribed");
      return;
    }

    // Permission is "granted" — check if actively subscribed
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "subscribed" : "unsubscribed");
    } catch {
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
      // Refresh session to get a valid token
      const { data: { session } } = await supabase.auth.refreshSession();
      if (!session?.access_token) throw new Error("Session expired");

      // 1. Register the push service worker
      const reg = await navigator.serviceWorker.register("/sw-push.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      // 2. Get VAPID public key from edge function
      const { data: vapidData, error: vapidErr } = await supabase.functions.invoke("manage-push", {
        body: { action: "get-vapid-key" },
      });
      if (vapidErr) throw new Error(vapidErr.message);

      const vapidPublicKey = vapidData.vapidPublicKey;
      if (!vapidPublicKey) throw new Error("No VAPID key returned");

      // 3. Request permission and subscribe
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        setError(permission === "denied"
          ? "Permission refusée. Ouvrez les paramètres de votre navigateur pour autoriser les notifications sur ce site."
          : "Permission non accordée.");
        return;
      }

      // 4. Clean up any stale subscription before creating new one
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        try { await existingSub.unsubscribe(); } catch { /* ignore */ }
      }

      // 5. Create fresh subscription
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      const subJson = subscription.toJSON();

      // 6. Store subscription in backend (with auth)
      const { error: subErr } = await supabase.functions.invoke("manage-push", {
        body: {
          action: "subscribe",
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (subErr) throw new Error(subErr.message);

      setState("subscribed");
      setError(null);
    } catch (err) {
      console.error("Push subscribe error:", err);
      setError(err instanceof Error ? err.message : String(err));
      // Re-detect actual state
      await detectState();
    }
  }, [user, detectState]);

  const unsubscribe = useCallback(async () => {
    setState("loading");
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.refreshSession();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();

        await supabase.functions.invoke("manage-push", {
          body: { action: "unsubscribe", endpoint },
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
        });
      }

      setState("unsubscribed");
    } catch (err) {
      console.error("Push unsubscribe error:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (testErr) throw new Error(testErr.message);
      setTestResult(data?.ok ? "sent" : "failed");

      // Auto-clear after 8s
      setTimeout(() => setTestResult(null), 8000);
    } catch (err) {
      console.error("Push test error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setTestResult("failed");
      setTimeout(() => setTestResult(null), 8000);
    }
  }, [state]);

  return { state, error, testResult, subscribe, unsubscribe, sendTest, detectState };
}
