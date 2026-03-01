import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPage() {
  const { t, lang } = useI18n();
  const fr = lang === "fr";

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setIsAndroid(/android/.test(ua));
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true
    );

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  };

  if (isStandalone) {
    return (
      <div className="h-full w-full bg-black text-white flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <span className="text-5xl">✅</span>
          <h1 className="font-mono text-xl tracking-widest text-white/90">
            {fr ? "Application installée" : "App Installed"}
          </h1>
          <p className="font-mono text-xs text-white/40">
            {fr
              ? "Vous utilisez déjà Tao Sentinel en mode application."
              : "You are already using Tao Sentinel as an app."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-black text-white overflow-auto p-4 sm:p-8 pt-16">
      <div className="max-w-lg mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-2"
            style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)" }}>
            <span className="text-4xl">◎</span>
          </div>
          <h1 className="font-mono text-xl sm:text-2xl tracking-widest text-white/90">
            Tao Sentinel
          </h1>
          <p className="font-mono text-[11px] text-white/40 tracking-wider">
            {fr
              ? "Installez l'app pour un accès rapide et hors-ligne"
              : "Install the app for quick access & offline use"}
          </p>
        </div>

        {/* Native install button (Chrome/Edge/Samsung) */}
        {deferredPrompt && !installed && (
          <div className="space-y-3">
            <button
              onClick={handleInstall}
              className="w-full font-mono text-sm tracking-wider py-4 rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-95"
              style={{
                background: "linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,215,0,0.05))",
                border: "1px solid rgba(255,215,0,0.3)",
                color: "rgba(255,215,0,0.9)",
                boxShadow: "0 0 30px rgba(255,215,0,0.08)",
              }}
            >
              {fr ? "⬇ Installer l'application" : "⬇ Install App"}
            </button>
            <p className="font-mono text-[9px] text-white/25 text-center">
              {fr ? "Installation rapide — aucun store requis" : "Quick install — no app store needed"}
            </p>
          </div>
        )}

        {installed && (
          <div className="text-center py-4 rounded-xl" style={{ background: "rgba(76,175,80,0.08)", border: "1px solid rgba(76,175,80,0.2)" }}>
            <span className="font-mono text-sm text-green-400/80">
              {fr ? "✓ Installation réussie !" : "✓ Successfully installed!"}
            </span>
          </div>
        )}

        {/* iOS Instructions */}
        <div className="space-y-4 rounded-xl p-5"
          style={{
            background: isIOS ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${isIOS ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
          }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🍎</span>
            <div>
              <h2 className="font-mono text-sm tracking-wider text-white/80">
                iPhone / iPad
              </h2>
              {isIOS && (
                <span className="font-mono text-[9px] px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(255,215,0,0.15)", color: "rgba(255,215,0,0.8)" }}>
                  {fr ? "Votre appareil" : "Your device"}
                </span>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <Step num={1} icon="🧭"
              text={fr ? "Ouvrir cette page dans Safari" : "Open this page in Safari"} />
            <Step num={2} icon="⬆️"
              text={fr ? "Appuyer sur le bouton Partager (⬆)" : "Tap the Share button (⬆)"} />
            <Step num={3} icon="➕"
              text={fr ? 'Choisir "Sur l\'écran d\'accueil"' : 'Select "Add to Home Screen"'} />
            <Step num={4} icon="✅"
              text={fr ? "Confirmer — l'app apparaît sur votre écran" : "Confirm — the app appears on your screen"} />
          </div>
        </div>

        {/* Android Instructions */}
        <div className="space-y-4 rounded-xl p-5"
          style={{
            background: isAndroid ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${isAndroid ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
          }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <h2 className="font-mono text-sm tracking-wider text-white/80">
                Android
              </h2>
              {isAndroid && (
                <span className="font-mono text-[9px] px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(255,215,0,0.15)", color: "rgba(255,215,0,0.8)" }}>
                  {fr ? "Votre appareil" : "Your device"}
                </span>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <Step num={1} icon="🌐"
              text={fr ? "Ouvrir cette page dans Chrome" : "Open this page in Chrome"} />
            <Step num={2} icon="⋮"
              text={fr ? "Appuyer sur le menu (⋮) en haut à droite" : 'Tap the menu (⋮) at top-right'} />
            <Step num={3} icon="📲"
              text={fr ? '"Installer l\'application" ou "Ajouter à l\'écran d\'accueil"' : '"Install app" or "Add to Home screen"'} />
            <Step num={4} icon="✅"
              text={fr ? "Confirmer — l'app est installée" : "Confirm — the app is installed"} />
          </div>
        </div>

        {/* Benefits */}
        <div className="space-y-3 pt-2">
          <h3 className="font-mono text-[10px] tracking-[0.2em] uppercase text-white/30">
            {fr ? "Avantages" : "Benefits"}
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <Benefit icon="⚡" label={fr ? "Accès instant" : "Instant access"} />
            <Benefit icon="📴" label={fr ? "Mode hors-ligne" : "Offline mode"} />
            <Benefit icon="🔔" label={fr ? "Notifications" : "Notifications"} />
          </div>
        </div>

        <p className="font-mono text-[9px] text-white/15 text-center pb-8">
          {fr
            ? "Tao Sentinel est une Progressive Web App — aucun téléchargement depuis un store requis."
            : "Tao Sentinel is a Progressive Web App — no app store download needed."}
        </p>
      </div>
    </div>
  );
}

function Step({ num, icon, text }: { num: number; icon: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-bold"
        style={{ background: "rgba(255,215,0,0.1)", color: "rgba(255,215,0,0.7)" }}>
        {num}
      </span>
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-base">{icon}</span>
        <span className="font-mono text-xs text-white/60">{text}</span>
      </div>
    </div>
  );
}

function Benefit({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="text-center py-3 rounded-lg" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <span className="text-lg block mb-1">{icon}</span>
      <span className="font-mono text-[9px] text-white/40">{label}</span>
    </div>
  );
}
