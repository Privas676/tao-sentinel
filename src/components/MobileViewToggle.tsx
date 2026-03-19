import type { MobileViewMode } from "@/hooks/use-mobile-view-mode";

interface Props {
  mode: MobileViewMode;
  onToggle: () => void;
}

export function MobileViewToggle({ mode, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      className="font-mono text-[9px] tracking-wider px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1.5"
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
        color: "hsl(var(--muted-foreground))",
      }}
      aria-label={mode === "cards" ? "Switch to table view" : "Switch to card view"}
    >
      {mode === "cards" ? (
        <>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1" y="1" width="4" height="4" rx="0.5" />
            <rect x="7" y="1" width="4" height="4" rx="0.5" />
            <rect x="1" y="7" width="4" height="4" rx="0.5" />
            <rect x="7" y="7" width="4" height="4" rx="0.5" />
          </svg>
          <span>Cartes</span>
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="1" y1="2" x2="11" y2="2" />
            <line x1="1" y1="5" x2="11" y2="5" />
            <line x1="1" y1="8" x2="11" y2="8" />
            <line x1="1" y1="11" x2="11" y2="11" />
          </svg>
          <span>Tableau</span>
        </>
      )}
    </button>
  );
}
