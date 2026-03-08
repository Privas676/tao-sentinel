import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ── Startup safeguard: clear stale caches ──
if ("caches" in window) {
  caches.keys().then((names) => {
    for (const name of names) {
      if (!name.includes("v0.1.15")) {
        caches.delete(name);
      }
    }
  });
}

// ── Force service worker update on load ──
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.update().catch(() => {});
    }
  });

  // Listen for new SW and force reload once
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!sessionStorage.getItem("sw_reloaded")) {
      sessionStorage.setItem("sw_reloaded", "1");
      window.location.reload();
    }
  });
}

// ── Startup redirect safeguard ──
try {
  const path = window.location.pathname;
  const knownRoutes = ["/compass", "/subnets", "/portfolio", "/alerts", "/settings", "/lab", "/auth", "/reset-password", "/profile", "/install"];
  const isKnown = path === "/" || knownRoutes.some((r) => path.startsWith(r));
  if (!isKnown && !path.startsWith("/~")) {
    console.warn("[startup] Unknown route, redirecting to /compass:", path);
    window.history.replaceState(null, "", "/compass");
  }
} catch {}

// Mount application
createRoot(document.getElementById("root")!).render(<App />);
