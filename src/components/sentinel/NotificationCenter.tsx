import { useState } from "react";
import { Bell, Copy, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signalAge } from "@/lib/formatters";

interface AlertEntry {
  id: number;
  netuid: number | null;
  type: string | null;
  ts: string | null;
  severity: number | null;
  evidence: any;
  subnet_name?: string;
}

export function NotificationCenter({ alerts }: { alerts: AlertEntry[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const filtered = alerts.filter(a => a.type === "GO" || a.type === "EARLY");

  const copyAlert = (a: AlertEntry) => {
    const mpi = a.evidence?.mpi ?? "—";
    const conf = a.evidence?.confidencePct ?? "—";
    const q = a.evidence?.Q ?? "—";
    const risk = (q >= 70) ? "CLEAN" : (q >= 40) ? "ATTENTION" : "STRUCTURAL";
    const url = `https://taostats.io/subnets/${a.netuid}`;
    const text = `🧠 Tao Sentinel\n${a.type} | ${a.subnet_name || `SN-${a.netuid}`}\nMPI: ${mpi}\nConfidence: ${conf}%\nRisk: ${risk}\n↗ ${url}`;
    navigator.clipboard.writeText(text);
    setCopied(a.id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" className="h-8 w-8 relative" onClick={() => setOpen(!open)}>
        <Bell className="h-4 w-4" />
        {filtered.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 bg-signal-go rounded-full text-[9px] font-bold flex items-center justify-center text-primary-foreground">
            {filtered.length}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 bg-card border border-border rounded-md shadow-xl max-h-96 overflow-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Signal Log</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setOpen(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          {filtered.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">No EARLY/GO signals yet</p>
          ) : (
            filtered.slice(0, 20).map((a) => (
              <div key={a.id} className="px-3 py-2 border-b border-border/50 flex items-start gap-2">
                <span className={cn("text-xs font-mono font-bold mt-0.5",
                  a.type === "GO" ? "text-signal-go" : "text-signal-go-spec"
                )}>{a.type}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{a.subnet_name || `SN-${a.netuid}`}</p>
                  <p className="text-[10px] text-muted-foreground">
                    MPI {a.evidence?.mpi ?? "—"} • {signalAge(a.ts)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => copyAlert(a)}>
                  {copied === a.id ? <Check className="h-3 w-3 text-signal-go" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
