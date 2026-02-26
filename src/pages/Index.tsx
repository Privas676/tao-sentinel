import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ActionBadge } from "@/components/sentinel/ActionBadge";
import { RiskPill } from "@/components/sentinel/RiskPill";
import { SentinelSparkline } from "@/components/sentinel/SentinelSparkline";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

type Signal = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  score: number | null;
  mpi: number | null;
  confidence_pct: number | null;
  quality_score: number | null;
  reasons: any;
  miner_filter: string | null;
  ts: string | null;
  last_state_change_at: string | null;
};

export default function SentinelCockpit() {
  const [allOpen, setAllOpen] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const navigate = useNavigate();

  const { data: signals, isLoading } = useQuery({
    queryKey: ["signals-latest"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as Signal[];
    },
    refetchInterval: 60000,
  });

  // Fetch sparkline data
  const { data: sparklines } = useQuery({
    queryKey: ["sparklines-30d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_price_daily")
        .select("netuid, date, price_close")
        .gte("date", new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0])
        .order("date", { ascending: true });
      if (error) throw error;
      const map: Record<number, number[]> = {};
      for (const row of data || []) {
        if (!map[row.netuid]) map[row.netuid] = [];
        map[row.netuid].push(Number(row.price_close) || 0);
      }
      return map;
    },
    refetchInterval: 300000,
  });

  const isNew = (s: Signal) => {
    if (testMode) return true;
    if (!s.last_state_change_at) return false;
    return Date.now() - new Date(s.last_state_change_at).getTime() < 10 * 60000;
  };

  const sorted = useMemo(() => {
    return [...(signals || [])].sort((a, b) => (b.confidence_pct || 0) - (a.confidence_pct || 0));
  }, [signals]);

  const actionable = sorted.filter(s => s.state === "GO" || s.state === "EARLY").slice(0, 5);
  const breakZone = sorted.filter(s => s.state === "BREAK");
  const allSubnets = sorted;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground font-mono text-sm animate-pulse">LOADING SIGNALS...</div>
      </div>
    );
  }

  const renderRow = (s: Signal) => (
    <TableRow key={s.netuid} className="border-border/30 hover:bg-accent/30 transition-colors cursor-pointer" onClick={() => navigate(`/subnet/${s.netuid}`)}>
      <TableCell className="font-mono text-xs py-2.5">
        <span className="text-muted-foreground">SN-{s.netuid}</span>
        <span className="ml-1.5 text-sm text-foreground">{s.subnet_name || ""}</span>
      </TableCell>
      <TableCell className="py-2.5">
        <SentinelSparkline data={sparklines?.[s.netuid!] || []} state={s.state} />
      </TableCell>
      <TableCell className="py-2.5">
        <ActionBadge state={s.state} isNew={isNew(s)} />
      </TableCell>
      <TableCell className="text-right font-mono text-sm font-bold text-primary py-2.5">
        {s.mpi ?? s.score ?? "—"}
      </TableCell>
      <TableCell className="text-right font-mono text-sm py-2.5">
        {s.confidence_pct != null ? `${s.confidence_pct}%` : "—"}
      </TableCell>
      <TableCell className="py-2.5">
        <RiskPill qualityScore={s.quality_score} reasons={s.reasons} />
      </TableCell>
      <TableCell className="py-2.5">
        <a
          href={`https://taostats.io/subnets/${s.netuid}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </TableCell>
    </TableRow>
  );

  const tableHeader = (
    <TableHeader>
      <TableRow className="border-border/30">
        <TableHead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Subnet</TableHead>
        <TableHead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground w-[80px]">30D</TableHead>
        <TableHead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Action</TableHead>
        <TableHead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground text-right w-14">MPI</TableHead>
        <TableHead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground text-right w-16">Conf%</TableHead>
        <TableHead className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Risk</TableHead>
        <TableHead className="w-8" />
      </TableRow>
    </TableHeader>
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Test Mode Toggle (dev only) */}
      {import.meta.env.DEV && (
        <div className="flex justify-end">
          <Button
            variant={testMode ? "destructive" : "outline"}
            size="sm"
            className="font-mono text-xs gap-1.5"
            onClick={() => setTestMode(!testMode)}
          >
            {testMode ? "⚡ TEST MODE ON" : "🧪 Test Glow"}
          </Button>
        </div>
      )}
      {/* Section 1: ACTIONABLE NOW */}
      {actionable.length > 0 && (
        <section>
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
            <span className="text-signal-go">🔥</span> ACTIONABLE NOW
            <span className="text-[10px] font-mono text-muted-foreground/60 ml-1">({actionable.length})</span>
          </h2>
          <div className="rounded-md border border-border/50 overflow-hidden bg-card/30">
            <Table>
              {tableHeader}
              <TableBody>{actionable.map(renderRow)}</TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Section 2: BREAK ZONE */}
      {breakZone.length > 0 && (
        <section>
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
            <span className="text-signal-exit">🚨</span> BREAK ZONE
            <span className="text-[10px] font-mono text-muted-foreground/60 ml-1">({breakZone.length})</span>
          </h2>
          <div className="rounded-md border border-signal-exit/20 overflow-hidden bg-signal-exit/5">
            <Table>
              {tableHeader}
              <TableBody>{breakZone.map(renderRow)}</TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Section 3: ALL SUBNETS */}
      <Collapsible open={allOpen} onOpenChange={setAllOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground h-8 px-2 hover:bg-accent/30">
            <span>ALL SUBNETS ({allSubnets.length})</span>
            {allOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="rounded-md border border-border/50 overflow-hidden bg-card/20">
            <Table>
              {tableHeader}
              <TableBody>{allSubnets.map(renderRow)}</TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
