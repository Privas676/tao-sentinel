import { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";

/**
 * Mobile-only swipe hint that appears once per session.
 * @param storageKey - unique sessionStorage key to track dismissal per page
 */
export default function SwipeHint({ storageKey }: { storageKey: string }) {
  const isMobile = useIsMobile();
  const { lang } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isMobile) return;
    const seen = sessionStorage.getItem(storageKey);
    if (seen) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      sessionStorage.setItem(storageKey, "1");
    }, 3000);
    return () => clearTimeout(timer);
  }, [isMobile, storageKey]);

  if (!visible) return null;

  return (
    <div
      className="flex items-center justify-center gap-2 py-2 mb-2 rounded-lg font-mono text-[11px] tracking-wider"
      style={{
        background: "rgba(255,215,0,0.06)",
        border: "1px solid rgba(255,215,0,0.12)",
        color: "rgba(255,215,0,0.6)",
        animation: "fade-in 0.4s ease-out, swipe-hint-out 0.5s ease-in 2.5s forwards",
      }}
    >
      <span style={{ display: "inline-block", animation: "swipe-arrow 1.2s ease-in-out infinite" }}>→</span>
      {lang === "fr" ? "Swipez pour voir plus" : "Swipe for more"}
      <span style={{ display: "inline-block", animation: "swipe-arrow 1.2s ease-in-out infinite" }}>→</span>
    </div>
  );
}
