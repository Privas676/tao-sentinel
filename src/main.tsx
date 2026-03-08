import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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

// Mount application
createRoot(document.getElementById("root")!).render(<App />);
