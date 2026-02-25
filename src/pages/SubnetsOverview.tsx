import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { SignalBadge, MinerBadge } from "@/components/SignalBadge";
import { signalAge, signalSortKey } from "@/lib/formatters";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Sparkline } from "@/components/Sparkline";

type SortKey = "price" | "cap" | "vol_24h" | "vol_cap" | "liquidity" | "flow_3m" | null;
type SortDir = "asc" | "desc";

const FILTERS = ["ALL", "GO", "GO_SPECULATIVE", "HOLD", "EXIT_FAST", "WATCH"] as const;

type DisplayRow = {
  netuid: number | null;
  price: number | null;
  price_usd: number | null;
  cap: number | null;
  cap_usd: number | null;
  vol_24h: number | null;
  vol_24h_usd: number | null;
  vol_cap: number | null;
  liquidity: number | null;
  liquidity_usd: number | null;
  flow_3m: number | null;
  miners_active: number | null;
  top_miners_share: number | null;
  tao_usd: number | null;
};

type SignalRow = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  score: number | null;
  miner_filter: string | null;
  ts: string | null;
  reasons: any;
};

export default function SubnetsOverview() {
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const navigate = useNavigate();
  const { currency, formatValue } = useCurrency();

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "desc"
      ? <ArrowDown className="h-3 w-3 ml-1" />
      : <ArrowUp className="h-3 w-3 ml-1" />;
  };

  const { data: metrics } = useQuery({
    queryKey: ["subnet-latest-display"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subnet_latest_display").select("*");
      if (error) throw error;
      return (data || []) as DisplayRow[];
    },
    refetchInterval: 60000,
  });

  const { data: lastTs } = useQuery({
    queryKey: ["last-metrics-ts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("ts")
        .order("ts", { ascending: false })
        .limit(1)
        .single();
      if (error) throw error;
      return data?.ts || null;
    },
    refetchInterval: 60000,
  });

  const { data: signals } = useQuery({
    queryKey: ["signals-latest"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as SignalRow[];
    },
    refetchInterval: 60000,
  });

  const since24h = useMemo(() => new Date(Date.now() - 24 * 3600 * 1000).toISOString(), []);

  const { data: priceHistory } = useQuery({
    queryKey: ["sparkline-prices", since24h],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("netuid, price, ts")
        .gte("ts", since24h)
        .not("price", "is", null)
        .order("ts", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 120000,
  });

  const sparklineMap = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const row of priceHistory || []) {
      if (row.netuid == null || row.price == null) continue;
      if (!map.has(row.netuid)) map.set(row.netuid, []);
      map.get(row.netuid)!.push(Number(row.price));
    }
    return map;
  }, [priceHistory]);

  const signalMap = new Map((signals || []).map((s) => [s.netuid, s]));

  const rows = (metrics || [])
    .map((m) => ({ ...m, signal: signalMap.get(m.netuid) || null }))
    .filter((r) => {
      if (filter !== "ALL" && r.signal?.state !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        const name = r.signal?.subnet_name || `SN-${r.netuid}`;
        return name.toLowerCase().includes(q) || String(r.netuid).includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (sortKey) {
        const valA = (currency === "USD" && sortKey === "price" ? a.price_usd
          : currency === "USD" && sortKey === "cap" ? a.cap_usd
          : currency === "USD" && sortKey === "vol_24h" ? a.vol_24h_usd
          : currency === "USD" && sortKey === "liquidity" ? a.liquidity_usd
          : a[sortKey]) ?? -Infinity;
        const valB = (currency === "USD" && sortKey === "price" ? b.price_usd
          : currency === "USD" && sortKey === "cap" ? b.cap_usd
          : currency === "USD" && sortKey === "vol_24h" ? b.vol_24h_usd
          : currency === "USD" && sortKey === "liquidity" ? b.liquidity_usd
          : b[sortKey]) ?? -Infinity;
        const cmp = valA - valB;
        if (cmp !== 0) return sortDir === "desc" ? -cmp : cmp;
      }
      return signalSortKey(a.signal?.state || null) - signalSortKey(b.signal?.state || null);
    });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subnets Overview</h1>
          <p className="text-sm text-muted-foreground">All Bittensor subnets with live metrics and signals</p>
        </div>
        {lastTs && (
          <p className="text-xs text-muted-foreground font-mono">
            Updated {signalAge(lastTs)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            className="text-xs font-mono"
            onClick={() => setFilter(f)}
          >
            {f === "GO_SPECULATIVE" ? "SPEC" : f}
          </Button>
        ))}
        <Input
          placeholder="Search subnet..."
          className="w-48 h-8 text-xs ml-auto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50">
              <TableHead className="w-16 font-mono">ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("price")}>
                <span className="inline-flex items-center">Price<SortIcon col="price" /></span>
              </TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("cap")}>
                <span className="inline-flex items-center">Cap<SortIcon col="cap" /></span>
              </TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("vol_24h")}>
                <span className="inline-flex items-center">Vol(24h)<SortIcon col="vol_24h" /></span>
              </TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("vol_cap")}>
                <span className="inline-flex items-center">Vol/Cap<SortIcon col="vol_cap" /></span>
              </TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("liquidity")}>
                <span className="inline-flex items-center">Liquidity<SortIcon col="liquidity" /></span>
              </TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("flow_3m")}>
                <span className="inline-flex items-center">Flow(3m)<SortIcon col="flow_3m" /></span>
              </TableHead>
              <TableHead>Miner</TableHead>
              <TableHead>Signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const sig = r.signal;
              const isExit = sig?.state === "EXIT_FAST";
              const isGo = sig?.state === "GO" || sig?.state === "GO_SPECULATIVE";
              const isHold = sig?.state === "HOLD";
              const taoUsd = r.tao_usd;
              return (
                <TableRow
                  key={r.netuid}
                  className={cn(
                    "cursor-pointer transition-colors",
                    isExit && "bg-signal-exit/10",
                    isGo && "border-l-2 border-l-signal-go",
                    isHold && "border-l-2 border-l-signal-hold"
                  )}
                  onClick={() => navigate(`/subnet/${r.netuid}`)}
                >
                  <TableCell className="font-mono text-xs">{r.netuid}</TableCell>
                  <TableCell className="font-medium text-sm">
                    {sig?.subnet_name || `SN-${r.netuid}`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    <div className="flex items-center justify-end gap-2">
                      <Sparkline data={sparklineMap.get(r.netuid!) || []} color="auto" />
                      <span>{currency === "USD" ? `$${(r.price_usd ?? 0).toFixed(2)}` : `τ${(r.price ?? 0).toFixed(4)}`}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {currency === "USD" ? `$${((r.cap_usd ?? 0) / 1e6).toFixed(1)}M` : `τ${((r.cap ?? 0) / 1e3).toFixed(1)}K`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {currency === "USD" ? `$${((r.vol_24h_usd ?? 0) / 1e3).toFixed(1)}K` : `τ${((r.vol_24h ?? 0)).toFixed(1)}`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.vol_cap != null ? `${(r.vol_cap * 100).toFixed(1)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {currency === "USD" ? `$${((r.liquidity_usd ?? 0) / 1e3).toFixed(1)}K` : `τ${(r.liquidity ?? 0).toFixed(1)}`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.flow_3m?.toFixed(2) ?? "—"}
                  </TableCell>
                  <TableCell>
                    <MinerBadge filter={sig?.miner_filter || null} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <SignalBadge state={sig?.state || null} />
                      <span className="text-xs text-muted-foreground">{signalAge(sig?.ts)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No subnet data available yet. Waiting for first data sync...
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
