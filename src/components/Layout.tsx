import { Link, useLocation, useNavigate } from "react-router-dom";
import { Radar, LayoutGrid, Bell, AlertTriangle, Menu, X, Zap, Settings, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { isStale } from "@/lib/formatters";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { playGoAlert, requestNotificationPermission, showGoNotification } from "@/lib/notifications";
import { useNotificationSettings } from "@/hooks/useNotificationSettings";
import { useLanguage } from "@/i18n/LanguageContext";
import { RegimeIndicator } from "@/components/sentinel/RegimeIndicator";
import { FreshnessDot } from "@/components/sentinel/FreshnessDot";
import { NotificationCenter } from "@/components/sentinel/NotificationCenter";

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { currency, toggleCurrency } = useCurrency();
  const { soundEnabled, pushEnabled } = useNotificationSettings();
  const { t, lang, toggleLang } = useLanguage();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [goBanner, setGoBanner] = useState<{ netuid: number; subnetName: string | null; score: number | null; state: string } | null>(null);

  const NAV = [
    { to: "/", label: "Cockpit", icon: Radar },
    { to: "/subnets", label: t("nav.subnets"), icon: LayoutGrid },
    { to: "/alerts", label: t("nav.alerts"), icon: Bell },
    { to: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  // Fetch signals for regime + counters
  const { data: signals } = useQuery({
    queryKey: ["signals-latest-layout"],
    queryFn: async () => {
      const { data } = await supabase.from("signals_latest").select("state, mpi, ts");
      return data || [];
    },
    refetchInterval: 60000,
  });

  // Fetch recent events for notification center
  const { data: recentAlerts } = useQuery({
    queryKey: ["recent-alerts"],
    queryFn: async () => {
      const { data } = await supabase.from("events").select("*").order("ts", { ascending: false }).limit(50);
      return data || [];
    },
    refetchInterval: 60000,
  });

  const avgMpi = useMemo(() => {
    if (!signals?.length) return 50;
    const mpis = signals.map((s: any) => s.mpi || 0);
    return Math.round(mpis.reduce((a: number, b: number) => a + b, 0) / mpis.length);
  }, [signals]);

  const counts = useMemo(() => {
    const s = signals || [];
    return {
      early: s.filter((x: any) => x.state === "EARLY").length,
      go: s.filter((x: any) => x.state === "GO").length,
      break_: s.filter((x: any) => x.state === "BREAK").length,
    };
  }, [signals]);

  const latestTs = useMemo(() => {
    if (!signals?.length) return null;
    return signals.reduce((max: string | null, s: any) => {
      if (!s.ts) return max;
      if (!max) return s.ts;
      return s.ts > max ? s.ts : max;
    }, null);
  }, [signals]);

  useEffect(() => {
    const channel = supabase
      .channel("go-signals")
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, (payload) => {
        const row = payload.new as any;
        if (row?.state === "GO" || row?.state === "EARLY" || row?.state === "BREAK") {
          supabase.from("subnets").select("name").eq("netuid", row.netuid).maybeSingle().then(({ data }) => {
            const name = data?.name || null;
            setGoBanner({ netuid: row.netuid, subnetName: name, score: row.mpi || row.score, state: row.state });
            if (soundEnabled) playGoAlert();
            if (pushEnabled) showGoNotification(name || `SN-${row.netuid}`, row.netuid, row.mpi || row.score);
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [soundEnabled, pushEnabled]);

  useEffect(() => {
    if (!goBanner) return;
    const timer = setTimeout(() => setGoBanner(null), 30000);
    return () => clearTimeout(timer);
  }, [goBanner]);

  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  const stale = isStale(latestTs);
  const isBreak = goBanner?.state === "BREAK";

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <div>
            <h1 className="text-sm font-bold text-foreground tracking-tight font-mono">TAO SENTINEL</h1>
            <p className="text-[10px] text-muted-foreground font-mono tracking-wider">EARLY ALPHA COCKPIT</p>
          </div>
        </div>
        {isMobile && (
          <Button variant="ghost" size="icon" className="h-8 w-8 absolute top-3 right-3" onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors font-mono",
              pathname === to
                ? "bg-sidebar-accent text-sidebar-primary font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-3 border-t border-sidebar-border space-y-3">
        <RegimeIndicator avgMpi={avgMpi} />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 font-mono text-xs" onClick={toggleCurrency}>
            {currency === "USD" ? "$ USD" : "τ TAO"}
          </Button>
          <Button variant="outline" size="sm" className="font-mono text-xs flex items-center gap-1" onClick={toggleLang}>
            <Globe className="h-3 w-3" />
            {lang.toUpperCase()}
          </Button>
        </div>
        {stale && (
          <div className="flex items-center gap-1.5 text-xs text-signal-exit font-mono">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>DATA STALE</span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden md:flex w-52 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex-col">
        {sidebarContent}
      </aside>

      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-10 w-60 bg-sidebar border-r border-sidebar-border flex flex-col animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </aside>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        {/* Top bar */}
        <div className="bg-card/50 border-b border-border px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
            )}
            <FreshnessDot ts={latestTs} />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              {counts.early > 0 && <span className="text-signal-go-spec mr-3">EARLY {counts.early}</span>}
              {counts.go > 0 && <span className="text-signal-go mr-3">GO {counts.go}</span>}
              {counts.break_ > 0 && <span className="text-signal-exit">BREAK {counts.break_}</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationCenter alerts={recentAlerts || []} />
          </div>
        </div>

        {/* Banner */}
        {goBanner && (
          <div className={cn(
            "border-b px-4 py-2 flex items-center justify-center gap-3 animate-in slide-in-from-top duration-300",
            isBreak ? "bg-signal-exit/15 border-signal-exit/30" : "bg-signal-go/15 border-signal-go/30"
          )}>
            <Zap className={cn("h-4 w-4 flex-shrink-0", isBreak ? "text-signal-exit" : "text-signal-go")} />
            <span className={cn("text-sm font-medium font-mono", isBreak ? "text-signal-exit" : "text-signal-go")}>
              {isBreak ? "🚨" : goBanner.state === "EARLY" ? "⚡" : "🚀"} {goBanner.state} — {goBanner.subnetName || `SN-${goBanner.netuid}`}
              {goBanner.score != null && <span className="ml-1">(MPI {goBanner.score})</span>}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6 ml-1" onClick={() => setGoBanner(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
