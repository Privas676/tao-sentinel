import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SignalBadge, MinerBadge } from "@/components/SignalBadge";
import { formatZurichTime, signalAge } from "@/lib/formatters";
import { useCurrency } from "@/hooks/useCurrency";
import { useLanguage } from "@/i18n/LanguageContext";
import { useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowLeft } from "lucide-react";

export default function SubnetDetail() {
  const { netuid } = useParams<{ netuid: string }>();
  const nid = Number(netuid);
  const navigate = useNavigate();
  const [range, setRange] = useState<"6h" | "24h">("6h");
  const { currency } = useCurrency();
  const { t, lang } = useLanguage();
  const isMobile = useIsMobile();

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

  const chartData = (metrics || []).map((m: any) => ({
    time: new Date(m.ts).toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }),
    price: currency === "USD" && fxRate ? (m.price || 0) * fxRate : m.price,
    liquidity: currency === "USD" && fxRate ? (m.liquidity || 0) * fxRate : m.liquidity,
    flow_3m: m.flow_3m,
    flow_6m: m.flow_6m,
    flow_15m: m.flow_15m,
    buys: m.daily_chain_buys_3m,
  }));

  const prefix = currency === "USD" ? "$" : "τ";

  const formatYAxis = useCallback((value: number, isCurrency: boolean) => {
    if (!isCurrency) return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toFixed(1);
    if (Math.abs(value) >= 1e6) return `${prefix}${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `${prefix}${(value / 1e3).toFixed(1)}K`;
    return `${prefix}${value.toFixed(2)}`;
  }, [prefix]);

  const formatTooltipValue = useCallback((value: number, isCurrency: boolean) => {
    if (!isCurrency) return value?.toFixed(2) ?? "—";
    return `${prefix}${value?.toFixed(4) ?? "—"}`;
  }, [prefix]);

  const name = signal?.subnet_name || `SN-${nid}`;
  const score = signal?.score ?? 0;

  // Confidence: based on score stability (simplified: high if score > 80, medium if > 60, low otherwise)
  const confidence = score >= 80 ? t("detail.high") : score >= 60 ? t("detail.medium") : t("detail.low");
  const confidenceColor = score >= 80 ? "text-signal-go" : score >= 60 ? "text-signal-hold" : "text-muted-foreground";

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 mt-1" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
            <p className="text-sm text-muted-foreground font-mono">NetUID {nid}</p>
          </div>
        </div>
        <div className="flex gap-1 ml-auto">
          <Button variant={range === "6h" ? "default" : "outline"} size="sm" onClick={() => setRange("6h")}>6h</Button>
          <Button variant={range === "24h" ? "default" : "outline"} size="sm" onClick={() => setRange("24h")}>24h</Button>
        </div>
      </div>

      {/* Score + Action + Confidence row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center">
            <span className="text-xs text-muted-foreground mb-1">{t("detail.score")}</span>
            <span className="text-4xl font-mono font-bold text-primary">{score}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center gap-2">
            <span className="text-xs text-muted-foreground mb-1">{t("table.action")}</span>
            <SignalBadge state={signal?.state || null} lang={lang} className="text-sm px-3 py-1" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center">
            <span className="text-xs text-muted-foreground mb-1">{t("detail.confidence")}</span>
            <span className={`text-lg font-bold font-mono ${confidenceColor}`}>{confidence}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center gap-1">
            <span className="text-xs text-muted-foreground mb-1">{t("table.miner")}</span>
            <MinerBadge filter={signal?.miner_filter || null} />
            <span className="text-xs text-muted-foreground">{signalAge(signal?.ts)}</span>
          </CardContent>
        </Card>
      </div>

      {/* Why explanation panel */}
      {signal?.reasons && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("detail.drivers")}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 flex-wrap">
            {(Array.isArray(signal.reasons) ? signal.reasons : []).map((r: string, i: number) => (
              <span key={i} className="text-xs bg-secondary px-2.5 py-1 rounded text-secondary-foreground">{r}</span>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Charts - Flow multi-TF, Liquidity, Price */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Flow Multi-TF */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("detail.flow")}</CardTitle>
          </CardHeader>
          <CardContent className={isMobile ? "h-40" : "h-56"}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: isMobile ? 0 : 10, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v.toFixed(1)} width={45} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))", fontSize: 12 }} />
                <Line type="monotone" dataKey="flow_3m" stroke="hsl(var(--signal-go))" dot={false} strokeWidth={1.5} name="3m" />
                <Line type="monotone" dataKey="flow_6m" stroke="hsl(var(--signal-go-spec))" dot={false} strokeWidth={1.5} name="6m" />
                <Line type="monotone" dataKey="flow_15m" stroke="hsl(var(--signal-hold))" dot={false} strokeWidth={1.5} name="15m" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Liquidity Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("detail.liqTrend")}</CardTitle>
          </CardHeader>
          <CardContent className={isMobile ? "h-40" : "h-56"}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: isMobile ? 0 : 10, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => formatYAxis(v, true)} width={55} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))", fontSize: 12 }} formatter={(value: number) => [formatTooltipValue(value, true), t("table.liquidity")]} />
                <Line type="monotone" dataKey="liquidity" stroke="hsl(var(--chart-2))" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Price */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("detail.priceTrend")} ({currency})</CardTitle>
          </CardHeader>
          <CardContent className={isMobile ? "h-40" : "h-56"}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: isMobile ? 0 : 10, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => formatYAxis(v, true)} width={55} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))", fontSize: 12 }} formatter={(value: number) => [formatTooltipValue(value, true), t("detail.priceTrend")]} />
                <Line type="monotone" dataKey="price" stroke="hsl(var(--chart-1))" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Event Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("detail.events")}</CardTitle>
        </CardHeader>
        <CardContent>
          {(events || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("detail.noEvents")}</p>
          ) : (
            <div className="space-y-2">
              {(events || []).map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 text-sm border-b border-border pb-2 last:border-0">
                  <SignalBadge state={ev.type} lang={lang} className="min-w-[80px] text-center" />
                  <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                    {formatZurichTime(ev.ts)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("alerts.severity")}: {ev.severity}
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
