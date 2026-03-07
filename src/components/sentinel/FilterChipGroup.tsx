interface FilterChip {
  key: string;
  label: string;
  icon?: string;
  count?: number;
}

interface FilterChipGroupProps {
  chips: FilterChip[];
  active: string;
  onChange: (key: string) => void;
}

export function FilterChipGroup({ chips, active, onChange }: FilterChipGroupProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(chip => {
        const isActive = chip.key === active;
        return (
          <button
            key={chip.key}
            onClick={() => onChange(chip.key)}
            className="font-mono text-[9px] tracking-wider px-2.5 py-1.5 rounded-md transition-all"
            style={{
              background: isActive ? "hsla(var(--gold), 0.08)" : "hsla(0,0%,100%,0.02)",
              color: isActive ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
              border: `1px solid ${isActive ? "hsla(var(--gold), 0.2)" : "hsla(0,0%,100%,0.05)"}`,
              opacity: isActive ? 1 : 0.6,
            }}
          >
            {chip.icon && <span className="mr-1">{chip.icon}</span>}
            {chip.label}
            {typeof chip.count === "number" && (
              <span className="ml-1 opacity-50">({chip.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
