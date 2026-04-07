import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const isPreviewHost = (() => {
  try {
    return window.location.hostname.includes("id-preview--");
  } catch {
    return false;
  }
})();

async function stabilizePreviewRuntime() {
  if (!isPreviewHost) return;

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)));
    }

    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name).catch(() => false)));
    }

    sessionStorage.removeItem("sw_reloaded");
  } catch (error) {
    console.warn("[startup] Preview stabilization failed:", error);
  }
}

function hardenStartupRoute() {
  try {
    const path = window.location.pathname;
    const knownRoutes = [
      "/",
      "/compass",
      "/subnets",
      "/portfolio",
      "/alerts",
      "/settings",
      "/lab",
      "/auth",
      "/reset-password",
      "/profile",
      "/install",
      "/methodology",
      "/quant-diagnostics",
      "/radar",
    ];

    const isKnown = knownRoutes.some((route) => path === route || path.startsWith(`${route}/`));

    if (!isKnown && !path.startsWith("/~")) {
      console.warn("[startup] Unknown route, redirecting to /compass:", path);
      window.history.replaceState(null, "", "/compass");
    }
  } catch {
    // no-op
  }
}

function mountApp() {
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element #root not found");
  createRoot(root).render(<App />);
}

// ── BOOT: mount immediately, never block on async cleanup ──
hardenStartupRoute();

try {
  mountApp();
} catch (error) {
  console.error("[startup] Boot crash:", error);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;padding:24px;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;background:#0a0a0a;color:#f5f5f5;">
        <section style="max-width:560px;text-align:center;line-height:1.6;">
          <h1 style="font-size:14px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px;opacity:.9;">Boot diagnostic</h1>
          <p style="font-size:12px;opacity:.75;margin:0 0 16px;">Le chargement initial a échoué. Rechargez la page. Si le problème persiste, ouvrez /compass directement.</p>
          <a href="/compass" style="display:inline-block;padding:8px 12px;border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#f5f5f5;text-decoration:none;font-size:11px;letter-spacing:.06em;">Aller à Compass</a>
        </section>
      </main>
    `;
  }
}

// Async cleanup runs in background — never blocks rendering
stabilizePreviewRuntime().catch(() => {});

const CURRENT_VERSION = "v0.3.5";

if (!isPreviewHost && "caches" in window) {
  caches.keys().then((names) => {
    for (const name of names) {
      if (!name.includes(CURRENT_VERSION)) {
        console.log("[startup] Purging stale cache:", name);
        caches.delete(name);
      }
    }
  });
}

if (!isPreviewHost && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.update().catch(() => {});
    }
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!sessionStorage.getItem("sw_reloaded")) {
      sessionStorage.setItem("sw_reloaded", "1");
      window.location.reload();
    }
  });
}
