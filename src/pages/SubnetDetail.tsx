import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SignalBadge, MinerBadge } from "@/components/SignalBadge";
import { formatZurichTime, signalAge } from "@/lib/formatters";
import { useCurrency } from "@/hooks/useCurrency";
import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export default function SubnetDetail() {
  const { netuid } = useParams<{ netuid: string }>();
  const nid = Number(netuid);
  const [range, setRange] = useState<"6h" | "24h">("6h");
  const { currency } = useCurrency();

  const since = new Date(Date.now() - (range === "6h" ? 6 : 24) * 3600 * 1000).toISOString();

  const { data: metrics } = useQuery({
    queryKey: ["subnet-metrics", nid, range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subnet_metrics_ts")
        .select("*")
        .eq("netuid", nid)
        .gte("ts", since)
        .order("ts", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000,
  });

  const { data: signal } = useQuery({
    queryKey: ["signal", nid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signals_latest")
        .select("*")
        .eq("netuid", nid)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 60000,
  });

  const { data: events } = useQuery({
    queryKey: ["events", nid, range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("netuid", nid)
        .gte("ts", since)
        .order("ts", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000,
  });

  const { data: fxRate } = useQuery({
    queryKey: ["fx-latest"],
    queryFn: async () => {
      const { data } = await supabase.from("fx_latest").select("*").maybeSingle();
      return data?.tao_usd || null;
    },
    refetchInterval: 60000,
  });

  const chartData = (metrics || []).map((m) => ({
    time: new Date(m.ts).toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }),
    price: currency === "USD" && fxRate ? (m.price || 0) * fxRate : m.price,
    liquidity: currency === "USD" && fxRate ? (m.liquidity || 0) * fxRate : m.liquidity,
    flow: m.flow_3m,
    buys: m.daily_chain_buys_3m,
  }));

  const name = signal?.subnet_name || `SN-${nid}`;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
          <p className="text-sm text-muted-foreground font-mono">NetUID {nid}</p>
        </div>
        <div className="flex items-center gap-3">
          {signal && (
            <>
              <SignalBadge state={signal.state} />
              <MinerBadge filter={signal.miner_filter} />
              <span className="text-sm font-mono text-primary font-bold">{signal.score ?? "—"}</span>
              <span className="text-xs text-muted-foreground">{signalAge(signal.ts)}</span>
            </>
          )}
          <div className="flex gap-1 ml-4">
            <Button variant={range === "6h" ? "default" : "outline"} size="sm" onClick={() => setRange("6h")}>6h</Button>
            <Button variant={range === "24h" ? "default" : "outline"} size="sm" onClick={() => setRange("24h")}>24h</Button>
          </div>
        </div>
      </div>

      {/* Drivers */}
      {signal?.reasons && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Drivers</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 flex-wrap">
            {(Array.isArray(signal.reasons) ? signal.reasons : []).map((r: string, i: number) => (
              <span key={i} className="text-xs bg-secondary px-2.5 py-1 rounded text-secondary-foreground">{r}</span>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { key: "price", label: `Price (${currency})`, color: "hsl(var(--chart-1))" },
          { key: "liquidity", label: `Liquidity (${currency})`, color: "hsl(var(--chart-2))" },
          { key: "flow", label: "Flow (3m)", color: "hsl(var(--chart-3))" },
          { key: "buys", label: "Buys (3m)", color: "hsl(var(--chart-4))" },
        ].map(({ key, label, color }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      color: "hsl(var(--foreground))",
                      fontSize: 12,
                    }}
                  />
                  <Line type="monotone" dataKey={key} stroke={color} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Event Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Event Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {(events || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No events in this time range</p>
          ) : (
            <div className="space-y-2">
              {(events || []).map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 text-sm border-b border-border pb-2 last:border-0">
                  <SignalBadge state={ev.type} className="min-w-[80px] text-center" />
                  <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                    {formatZurichTime(ev.ts)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Severity: {ev.severity}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
