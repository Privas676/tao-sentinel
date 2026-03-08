export function PageLoadingState({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
      <span className="font-mono text-[10px] text-muted-foreground/50 tracking-widest font-bold">
        {label || "Chargement..."}
      </span>
    </div>
  );
}

export function PageErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-6">
      <span style={{ fontSize: 28, opacity: 0.35 }}>🔌</span>
      <span className="font-mono text-[11px] font-bold text-foreground/70 tracking-wider">
        Erreur de chargement
      </span>
      {message && (
        <span className="font-mono text-[9px] text-muted-foreground/50 max-w-xs text-center leading-relaxed">
          {message}
        </span>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="font-mono text-[10px] font-bold tracking-wider px-4 py-2 rounded-lg transition-colors"
          style={{
            background: "hsla(var(--primary), 0.08)",
            color: "hsl(var(--primary))",
            border: "1px solid hsla(var(--primary), 0.15)",
          }}
        >
          ↻ Réessayer
        </button>
      )}
    </div>
  );
}
