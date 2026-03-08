import { useState, useEffect } from "react";
import { SectionCard, SectionTitle, SettingRow } from "./SettingsShared";
import { APP_VERSION, BUILD_TAG } from "@/lib/version";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "desktop";
type InstallStatus = "installable" | "not-installable" | "installed";

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

const GOLD = "hsl(var(--gold))";
const GO = "hsl(var(--signal-go))";

export default function InstallSection({ fr }: { fr: boolean }) {
  const [platform] = useState<Platform>(detectPlatform);
  const [standalone, setStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);
  const [swStatus, setSwStatus] = useState<string>("—");

  useEffect(() => {
    setStandalone(isStandalone());

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setJustInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // SW status
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) setSwStatus(fr ? "Non enregistré" : "Not registered");
        else if (reg.waiting) setSwStatus(fr ? "Mise à jour prête" : "Update ready");
        else if (reg.active) setSwStatus(fr ? "Actif ✓" : "Active ✓");
        else setSwStatus(fr ? "En cours…" : "Pending…");
      });
    } else {
      setSwStatus(fr ? "Non supporté" : "Not supported");
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [fr]);

  const installStatus: InstallStatus = standalone || justInstalled
    ? "installed"
    : deferredPrompt
      ? "installable"
      : "not-installable";

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setJustInstalled(true);
    setDeferredPrompt(null);
  };

  const platformLabel: Record<Platform, string> = {
    ios: "iPhone / iPad",
    android: "Android",
    desktop: "Desktop",
  };

  const statusConfig: Record<InstallStatus, { label: string; color: string; icon: string }> = {
    installed: { label: fr ? "Installée ✓" : "Installed ✓", color: GO, icon: "✅" },
    installable: { label: fr ? "Installable" : "Installable", color: GOLD, icon: "📲" },
    "not-installable": {
      label: platform === "ios"
        ? (fr ? "Via Safari" : "Via Safari")
        : (fr ? "Non disponible" : "Not available"),
      color: "hsl(var(--muted-foreground))",
      icon: platform === "ios" ? "🍎" : "—",
    },
  };

  const status = statusConfig[installStatus];

  return (
    <SectionCard>
      <SectionTitle icon="📲" title={fr ? "Installation mobile" : "Mobile install"} />

      {/* Status */}
      <SettingRow label={fr ? "Statut" : "Status"} description={fr ? "État d'installation de l'application" : "App installation state"}>
        <span className="font-mono text-[10px] font-medium" style={{ color: status.color }}>
          {status.icon} {status.label}
        </span>
      </SettingRow>

      {/* Platform */}
      <SettingRow label={fr ? "Plateforme" : "Platform"} description={fr ? "Appareil détecté" : "Detected device"}>
        <span className="font-mono text-[10px] text-muted-foreground">{platformLabel[platform]}</span>
      </SettingRow>

      {/* Version */}
      <SettingRow label="Build" description={fr ? "Version et tag de build" : "Version and build tag"}>
        <span className="font-mono text-[10px] text-muted-foreground">{APP_VERSION} · {BUILD_TAG}</span>
      </SettingRow>

      {/* Service Worker */}
      <SettingRow label="Service Worker" description={fr ? "Cache et mises à jour" : "Cache and updates"}>
        <span className="font-mono text-[10px] text-muted-foreground">{swStatus}</span>
      </SettingRow>

      {/* Install button (Android/Chrome) */}
      {installStatus === "installable" && (
        <div className="px-5 pb-4 pt-1">
          <button
            onClick={handleInstall}
            className="w-full font-mono text-[11px] tracking-wider py-3 rounded-xl transition-all duration-200 hover:scale-[1.01] active:scale-95"
            style={{
              background: "linear-gradient(135deg, hsla(var(--gold), 0.15), hsla(var(--gold), 0.05))",
              border: "1px solid hsla(var(--gold), 0.3)",
              color: GOLD,
              boxShadow: "0 0 20px hsla(var(--gold), 0.06)",
            }}
          >
            {fr ? "⬇ Installer l'application" : "⬇ Install App"}
          </button>
        </div>
      )}

      {/* iOS instructions */}
      {platform === "ios" && installStatus !== "installed" && (
        <div className="mx-5 mb-4 rounded-xl p-4 space-y-3" style={{ background: "hsla(var(--muted), 0.3)", border: "1px solid hsl(var(--border))" }}>
          <p className="font-mono text-[10px] text-gold tracking-wider font-medium">
            {fr ? "INSTRUCTIONS IPHONE / IPAD" : "IPHONE / IPAD INSTRUCTIONS"}
          </p>
          {[
            { n: 1, icon: "🧭", text: fr ? "Ouvrir cette page dans Safari" : "Open this page in Safari" },
            { n: 2, icon: "⬆️", text: fr ? "Appuyer sur le bouton Partager (⬆)" : "Tap the Share button (⬆)" },
            { n: 3, icon: "➕", text: fr ? 'Choisir "Sur l\'écran d\'accueil"' : 'Select "Add to Home Screen"' },
            { n: 4, icon: "✅", text: fr ? "Confirmer — l'app apparaît sur votre écran" : "Confirm — app appears on your screen" },
          ].map((s) => (
            <div key={s.n} className="flex items-start gap-3">
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-mono text-[9px] font-bold"
                style={{ background: "hsla(var(--gold), 0.1)", color: GOLD }}
              >
                {s.n}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1.5">
                <span>{s.icon}</span> {s.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Installed confirmation */}
      {installStatus === "installed" && (
        <div className="mx-5 mb-4 py-3 rounded-xl text-center" style={{ background: `color-mix(in srgb, ${GO} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${GO} 20%, transparent)` }}>
          <span className="font-mono text-[10px]" style={{ color: GO }}>
            {fr ? "Vous utilisez TAO Sentinel en mode application." : "You are using TAO Sentinel as an app."}
          </span>
        </div>
      )}
    </SectionCard>
  );
}
