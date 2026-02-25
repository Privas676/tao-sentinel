export function formatZurichTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

export function signalAge(ts: string | null | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function isStale(ts: string | null | undefined): boolean {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > 2 * 60 * 1000;
}

export const SIGNAL_ORDER: Record<string, number> = {
  EXIT_FAST: 0,
  GO: 1,
  GO_SPECULATIVE: 2,
  HOLD: 3,
  WATCH: 4,
  NO: 5,
};

export function signalSortKey(state: string | null): number {
  return SIGNAL_ORDER[state || "NO"] ?? 5;
}
