interface Tab {
  key: string;
  label: string;
  icon?: string;
  count?: number;
}

interface TabsInlineProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
}

export function TabsInline({ tabs, active, onChange }: TabsInlineProps) {
  return (
    <div className="flex border-b" style={{ borderColor: "hsla(0,0%,100%,0.06)" }}>
      {tabs.map(tab => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="relative flex items-center gap-1.5 px-3 sm:px-4 py-2.5 font-mono text-[9px] sm:text-[10px] tracking-wider transition-all"
            style={{
              color: isActive ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
              opacity: isActive ? 1 : 0.45,
            }}
          >
            {tab.icon && <span style={{ fontSize: 11 }}>{tab.icon}</span>}
            <span>{tab.label}</span>
            {typeof tab.count === "number" && (
              <span
                className="font-mono text-[8px] px-1.5 py-0.5 rounded"
                style={{
                  background: isActive ? "hsla(var(--gold), 0.1)" : "hsla(0,0%,100%,0.04)",
                  color: isActive ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
                }}
              >
                {tab.count}
              </span>
            )}
            {isActive && (
              <span
                className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                style={{ background: "hsl(var(--gold))" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
