interface EmptyStateTacticalProps {
  icon?: string;
  title: string;
  description?: string;
}

export function EmptyStateTactical({ icon = "📭", title, description }: EmptyStateTacticalProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 rounded-xl"
      style={{
        background: "hsla(0,0%,100%,0.01)",
        border: "1px dashed hsla(0,0%,100%,0.06)",
      }}
    >
      <span style={{ fontSize: 24, opacity: 0.3 }}>{icon}</span>
      <span className="font-mono text-[11px] text-muted-foreground/30 tracking-wider mt-2 font-bold">
        {title}
      </span>
      {description && (
        <span className="font-mono text-[9px] text-muted-foreground/20 mt-1 max-w-xs text-center leading-relaxed">
          {description}
        </span>
      )}
    </div>
  );
}
