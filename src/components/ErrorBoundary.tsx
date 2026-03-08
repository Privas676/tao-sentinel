import React, { Component, type ReactNode } from "react";

type Props = { children: ReactNode; fallbackTitle?: string };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-6">
        <span style={{ fontSize: 32, opacity: 0.4 }}>⚠️</span>
        <h2 className="font-mono text-sm font-bold text-foreground/80 tracking-wider">
          {this.props.fallbackTitle || "Erreur inattendue"}
        </h2>
        <p className="font-mono text-[10px] text-muted-foreground max-w-sm text-center leading-relaxed">
          {this.state.error?.message || "Une erreur est survenue lors du rendu de cette section."}
        </p>
        <button
          onClick={this.handleRetry}
          className="font-mono text-[10px] font-bold tracking-wider px-4 py-2 rounded-lg transition-colors"
          style={{
            background: "hsla(var(--primary), 0.08)",
            color: "hsl(var(--primary))",
            border: "1px solid hsla(var(--primary), 0.15)",
          }}
        >
          ↻ Réessayer
        </button>
      </div>
    );
  }
}
