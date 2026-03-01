import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    // Check if already subscribed
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "subscribed" : "unsubscribed");
    }).catch(() => setState("unsubscribed"));
  }, []);

  const subscribe = useCallback(async () => {
    setState("loading");
    setError(null);

    try {
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
        return;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      const subJson = subscription.toJSON();

      // 4. Store subscription in backend
      const { error: subErr } = await supabase.functions.invoke("manage-push", {
        body: {
          action: "subscribe",
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
      });
      if (subErr) throw new Error(subErr.message);

      setState("subscribed");
    } catch (err) {
      console.error("Push subscribe error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setState("unsubscribed");
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setState("loading");
    setError(null);

    try {
      const reg = await navigator.serviceWorker.ready;
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
      console.error("Push unsubscribe error:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return { state, error, subscribe, unsubscribe };
}
