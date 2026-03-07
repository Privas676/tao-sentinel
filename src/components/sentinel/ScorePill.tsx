interface ScorePillProps {
  label: string;
  value: string | number;
  color: string;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: { label: 6, value: 9 },
  md: { label: 7, value: 14 },
  lg: { label: 8, value: 20 },
};

export function ScorePill({ label, value, color, size = "md" }: ScorePillProps) {
  const s = sizes[size];
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="font-mono text-muted-foreground/30 uppercase"
        style={{ fontSize: s.label, letterSpacing: "0.12em" }}
      >
        {label}
      </span>
      <span className="font-mono font-bold leading-none" style={{ color, fontSize: s.value }}>
        {value}
      </span>
    </div>
  );
}
