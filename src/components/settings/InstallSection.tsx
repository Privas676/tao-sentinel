import { useState, useEffect, useCallback } from "react";
import { SectionCard, SectionTitle, SettingRow } from "./SettingsShared";
import { APP_VERSION, BUILD_TAG } from "@/lib/version";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "desktop";

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
const BREAK = "hsl(var(--signal-break))";

export default function InstallSection({ fr }: { fr: boolean }) {
  const [platform] = useState<Platform>(detectPlatform);
  const [standalone, setStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);
  const [swInfo, setSwInfo] = useState<{ status: string; color: string }>({ status: "—", color: "hsl(var(--muted-foreground))" });
  const [cacheCount, setCacheCount] = useState<number | null>(null);
  const [purged, setPurged] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());

    const onPrompt = (e: Event) => { e.preventDefault(); setDeferredPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setJustInstalled(true); setDeferredPrompt(null); };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // SW diagnostic
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) setSwInfo({ status: fr ? "Non enregistré" : "Not registered", color: "hsl(var(--muted-foreground))" });
        else if (reg.waiting) setSwInfo({ status: fr ? "⬆ Mise à jour prête" : "⬆ Update ready", color: GOLD });
        else if (reg.active) setSwInfo({ status: fr ? "Actif ✓" : "Active ✓", color: GO });
        else setSwInfo({ status: fr ? "En cours…" : "Pending…", color: GOLD });
      });
    } else {
      setSwInfo({ status: fr ? "Non supporté" : "Not supported", color: BREAK });
    }

    // Cache count
    if ("caches" in window) {
      caches.keys().then((names) => setCacheCount(names.length));
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [fr]);

  const isInstalled = standalone || justInstalled;
  const isInstallable = !isInstalled && !!deferredPrompt;
  const needsManual = !isInstalled && !deferredPrompt && platform === "ios";

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setJustInstalled(true);
    setDeferredPrompt(null);
  };

  const handlePurgeCache = useCallback(async () => {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      setCacheCount(0);
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        await reg.update().catch(() => {});
      }
    }
    setPurged(true);
    setTimeout(() => window.location.reload(), 800);
  }, []);

  const platformLabels: Record<Platform, { icon: string; label: string }> = {
    ios: { icon: "🍎", label: "iPhone / iPad" },
    android: { icon: "🤖", label: "Android" },
    desktop: { icon: "🖥", label: "Desktop" },
  };

  const pl = platformLabels[platform];

  return (
    <SectionCard>
      <SectionTitle icon="📲" title={fr ? "Installation mobile" : "Mobile install"} />

      {/* Installable */}
      <SettingRow label={fr ? "Installable" : "Installable"} description={fr ? "Le navigateur supporte l'installation directe" : "Browser supports direct install"}>
        <span className="font-mono text-[10px] font-medium" style={{ color: isInstallable || isInstalled ? GO : (needsManual ? GOLD : "hsl(var(--muted-foreground))") }}>
          {isInstallable ? (fr ? "✓ Oui" : "✓ Yes")
            : isInstalled ? (fr ? "✓ Oui" : "✓ Yes")
            : needsManual ? (fr ? "Manuel (Safari)" : "Manual (Safari)")
            : (fr ? "✗ Non" : "✗ No")}
        </span>
      </SettingRow>

      {/* Already installed */}
      <SettingRow label={fr ? "Déjà installée" : "Already installed"} description={fr ? "Mode standalone détecté" : "Standalone mode detected"}>
        <span className="font-mono text-[10px] font-medium" style={{ color: isInstalled ? GO : "hsl(var(--muted-foreground))" }}>
          {isInstalled ? (fr ? "✓ Oui" : "✓ Yes") : (fr ? "✗ Non" : "✗ No")}
        </span>
      </SettingRow>

      {/* Platform */}
      <SettingRow label={fr ? "Plateforme" : "Platform"} description={fr ? "Appareil détecté" : "Detected device"}>
        <span className="font-mono text-[10px] text-muted-foreground">{pl.icon} {pl.label}</span>
      </SettingRow>

      {/* Build */}
      <SettingRow label="Build" description={fr ? "Version et tag" : "Version and tag"}>
        <span className="font-mono text-[10px] text-muted-foreground">{APP_VERSION} · {BUILD_TAG}</span>
      </SettingRow>

      {/* Service Worker */}
      <SettingRow label="Service Worker" description={fr ? "État du worker de cache" : "Cache worker state"}>
        <span className="font-mono text-[10px] font-medium" style={{ color: swInfo.color }}>{swInfo.status}</span>
      </SettingRow>

      {/* Cache */}
      <SettingRow label="Cache" description={fr ? "Caches navigateur actifs" : "Active browser caches"}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {cacheCount !== null ? `${cacheCount} ${cacheCount === 1 ? "cache" : "caches"}` : "—"}
          </span>
          {!purged ? (
            <button
              onClick={handlePurgeCache}
              className="font-mono text-[9px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-gold hover:border-gold/30 transition-all"
            >
              {fr ? "Purger" : "Purge"}
            </button>
          ) : (
            <span className="font-mono text-[9px]" style={{ color: GO }}>✓</span>
          )}
        </div>
      </SettingRow>

      {/* Install button (Android/Chrome) */}
      {isInstallable && (
        <div className="px-5 pb-4 pt-2">
          <button
            onClick={handleInstall}
            className="w-full font-mono text-[11px] tracking-wider py-3 rounded-xl transition-all duration-200 hover:scale-[1.01] active:scale-95 border"
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${GOLD} 15%, transparent), color-mix(in srgb, ${GOLD} 5%, transparent))`,
              borderColor: `color-mix(in srgb, ${GOLD} 30%, transparent)`,
              color: GOLD,
              boxShadow: `0 0 20px color-mix(in srgb, ${GOLD} 6%, transparent)`,
            }}
          >
            {fr ? "⬇ Installer l'application" : "⬇ Install App"}
          </button>
          <p className="font-mono text-[9px] text-muted-foreground/50 text-center mt-2">
            {fr ? "Installation rapide — aucun store requis" : "Quick install — no app store needed"}
          </p>
        </div>
      )}

      {/* iOS instructions */}
      {needsManual && (
        <div className="mx-5 mb-4 rounded-xl p-4 space-y-3" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
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
                style={{ background: `color-mix(in srgb, ${GOLD} 10%, transparent)`, color: GOLD }}
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
      {isInstalled && (
        <div className="mx-5 mb-4 py-3 rounded-xl text-center" style={{ background: `color-mix(in srgb, ${GO} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${GO} 20%, transparent)` }}>
          <span className="font-mono text-[10px]" style={{ color: GO }}>
            {fr ? "✓ TAO Sentinel fonctionne en mode application." : "✓ TAO Sentinel is running as an app."}
          </span>
        </div>
      )}
    </SectionCard>
  );
}
