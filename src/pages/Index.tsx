import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SignalBadge, MinerBadge } from "@/components/SignalBadge";
import { signalAge, signalSortKey } from "@/lib/formatters";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageContext";
import { EcosystemHealth } from "@/components/EcosystemHealth";
import { AccelIndicator } from "@/components/AccelIndicator";
import { LiqIndicator } from "@/components/LiqIndicator";

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
  { key: "BREAK", filter: (s: Signal) => s.state === "BREAK" || s.state === "EXIT_FAST" },
  { key: "GO", filter: (s: Signal) => s.state === "GO" },
  { key: "GO_SPECULATIVE", filter: (s: Signal) => s.state === "GO_SPECULATIVE" },
  { key: "HOLD", filter: (s: Signal) => s.state === "HOLD" },
  { key: "WATCH", filter: (s: Signal) => s.state === "WATCH" },
];

export default function OperatorRadar() {
  const [onlyActionable, setOnlyActionable] = useState(false);
  const [onlyPass, setOnlyPass] = useState(false);
  const [hideWatch, setHideWatch] = useState(false);
  const { t, lang } = useLanguage();

  const { data: signals, isLoading } = useQuery({
    queryKey: ["signals-latest"],
    queryFn: async () => {
      const { data, error } = await supabase.from("signals_latest").select("*");
      if (error) throw error;
      return (data || []) as Signal[];
    },
    refetchInterval: 60000,
  });

  const filtered = (signals || []).filter((s) => {
    if (onlyPass && s.miner_filter !== "PASS") return false;
    if (onlyActionable && !["GO", "GO_SPECULATIVE", "BREAK", "EXIT_FAST"].includes(s.state || "")) return false;
    return true;
  });

  const visibleSections = SECTIONS.filter((sec) => {
    if (hideWatch && sec.key === "WATCH") return false;
    return true;
  });

  const stateEmoji: Record<string, string> = {
    BREAK: "🔴",
    GO: "🟢",
    GO_SPECULATIVE: "🟡",
    HOLD: "🔵",
    WATCH: "⚪",
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Ecosystem Health Panel */}
      {signals && signals.length > 0 && <EcosystemHealth signals={signals} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("radar.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("radar.subtitle")}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant={onlyActionable ? "default" : "outline"} size="sm" className="text-xs" onClick={() => setOnlyActionable(!onlyActionable)}>
            {t("radar.onlyActionable")}
          </Button>
          <Button variant={onlyPass ? "default" : "outline"} size="sm" className="text-xs" onClick={() => setOnlyPass(!onlyPass)}>
            {t("radar.onlyPass")}
          </Button>
          <Button variant={hideWatch ? "default" : "outline"} size="sm" className="text-xs" onClick={() => setHideWatch(!hideWatch)}>
            {t("radar.hideWatch")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t("loading")}</div>
      ) : (
        visibleSections.map((sec) => {
          const items = filtered.filter(sec.filter).sort((a, b) => (b.score || 0) - (a.score || 0));
          if (items.length === 0) return null;

          return (
            <div key={sec.key} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {stateEmoji[sec.key]} {t(`signal.${sec.key}` as any)} ({items.length})
              </h2>
              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/50">
                      <TableHead className="w-28">{t("table.subnet")}</TableHead>
                      <TableHead>{t("table.action")}</TableHead>
                      <TableHead className="text-right w-16">{t("table.score")}</TableHead>
                      <TableHead className="w-16">{t("table.accel")}</TableHead>
                      <TableHead className="w-16">{t("table.liquidity")}</TableHead>
                      <TableHead>{t("table.miner")}</TableHead>
                      <TableHead>{t("table.why")}</TableHead>
                      <TableHead className="text-right w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((s) => (
                      <TableRow key={s.netuid} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => window.location.href = `/subnet/${s.netuid}`}>
                        <TableCell className="font-medium text-sm">
                          <span className="font-mono text-xs text-muted-foreground mr-1.5">SN-{s.netuid}</span>
                          {s.subnet_name || ""}
                        </TableCell>
                        <TableCell>
                          <SignalBadge state={s.state} lang={lang} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-bold text-primary">
                          {s.score ?? "—"}
                        </TableCell>
                        <TableCell>
                          <AccelIndicator flow3m={null} flow6m={null} flow15m={null} />
                        </TableCell>
                        <TableCell>
                          <LiqIndicator />
                        </TableCell>
                        <TableCell>
                          <MinerBadge filter={s.miner_filter} />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap max-w-[200px]">
                            {(Array.isArray(s.reasons) ? s.reasons : []).slice(0, 3).map((r: string, i: number) => (
                              <span key={i} className="text-xs bg-secondary px-1.5 py-0.5 rounded text-secondary-foreground">
                                {r}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs text-muted-foreground">{signalAge(s.ts)}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
