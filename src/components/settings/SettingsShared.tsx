import React from "react";

/* ═══════════════════════════════════════════════════════ */
/*   Shared Settings / Lab UI primitives                    */
/* ═══════════════════════════════════════════════════════ */

const GOLD = "hsl(var(--gold))";

export function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card">{children}</div>;
}

export function SectionTitle({ icon, title, badge }: { icon: string; title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border">
      <span className="text-sm opacity-70">{icon}</span>
      <h2 className="font-mono text-[10px] tracking-[0.15em] uppercase text-gold">{title}</h2>
      {badge && <div className="ml-auto">{badge}</div>}
    </div>
  );
}

export function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-4 px-5 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] text-foreground/70 font-medium">{label}</div>
        {description && <div className="font-mono text-[9px] text-muted-foreground mt-0.5 max-w-sm">{description}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export function ToggleButtons<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; color?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-border">
      {options.map(opt => {
        const active = value === opt.value;
        const color = opt.color || GOLD;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)}
            className="font-mono text-[10px] tracking-wider px-3 py-1.5 transition-all"
            style={{
              background: active ? `color-mix(in srgb, ${color} 10%, transparent)` : "transparent",
              color: active ? color : "hsl(var(--muted-foreground))",
              fontWeight: active ? 700 : 400,
              opacity: active ? 1 : 0.5,
            }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
