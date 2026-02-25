import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SignalBadge, MinerBadge } from "@/components/SignalBadge";
import { signalAge, formatZurichTime } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "react-router-dom";

type Signal = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  score: number | null;
  reasons: any;
  miner_filter: string | null;
  ts: string | null;
};

const SECTIONS = [
  { key: "GO", title: "🟢 GO NOW", filter: (s: Signal) => s.state === "GO" },
  { key: "GO_SPECULATIVE", title: "🟡 GO SPECULATIVE", filter: (s: Signal) => s.state === "GO_SPECULATIVE" },
  { key: "HOLD", title: "🔵 HOLD", filter: (s: Signal) => s.state === "HOLD" },
  { key: "WATCH", title: "⚪ WATCH", filter: (s: Signal) => s.state === "WATCH" },
];

export default function GoRadar() {
  const [onlyPass, setOnlyPass] = useState(false);
  const [hideWatch, setHideWatch] = useState(false);

  const { data: signals, isLoading } = useQuery({
    queryKey: ["signals-latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signals_latest")
        .select("*");
      if (error) throw error;
      return (data || []) as Signal[];
    },
    refetchInterval: 60000,
  });

  const filtered = (signals || []).filter((s) => {
    if (onlyPass && s.miner_filter !== "PASS") return false;
    return true;
  });

  const visibleSections = SECTIONS.filter((sec) => {
    if (hideWatch && sec.key === "WATCH") return false;
    return true;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">GO Radar</h1>
          <p className="text-sm text-muted-foreground">Real-time alpha detection across all Bittensor subnets</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={onlyPass ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyPass(!onlyPass)}
          >
            Only PASS
          </Button>
          <Button
            variant={hideWatch ? "default" : "outline"}
            size="sm"
            onClick={() => setHideWatch(!hideWatch)}
          >
            Hide WATCH
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading signals...</div>
      ) : (
        visibleSections.map((sec) => {
          const items = filtered.filter(sec.filter);
          return (
            <div key={sec.key} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {sec.title} ({items.length})
              </h2>
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-2">No signals</p>
              ) : (
                <div className="grid gap-2">
                  {items
                    .sort((a, b) => (b.score || 0) - (a.score || 0))
                    .map((s) => (
                      <Link key={s.netuid} to={`/subnet/${s.netuid}`}>
                        <Card className="hover:bg-accent/50 transition-colors cursor-pointer border-l-2"
                          style={{
                            borderLeftColor: s.state === "GO" ? "hsl(var(--signal-go))"
                              : s.state === "GO_SPECULATIVE" ? "hsl(var(--signal-go-spec))"
                              : s.state === "HOLD" ? "hsl(var(--signal-hold))"
                              : "transparent"
                          }}
                        >
                          <CardContent className="p-4 flex items-center gap-4">
                            <span className="font-mono text-sm text-muted-foreground w-12">
                              SN-{s.netuid}
                            </span>
                            <span className="font-medium text-sm min-w-[100px]">
                              {s.subnet_name || `SN-${s.netuid}`}
                            </span>
                            <SignalBadge state={s.state} />
                            <span className="font-mono text-sm text-primary font-bold w-10 text-right">
                              {s.score ?? "—"}
                            </span>
                            <div className="flex-1 flex gap-1.5 flex-wrap">
                              {(Array.isArray(s.reasons) ? s.reasons : []).slice(0, 3).map((r: string, i: number) => (
                                <span key={i} className="text-xs bg-secondary px-2 py-0.5 rounded text-secondary-foreground">
                                  {r}
                                </span>
                              ))}
                            </div>
                            <MinerBadge filter={s.miner_filter} />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {signalAge(s.ts)}
                            </span>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
