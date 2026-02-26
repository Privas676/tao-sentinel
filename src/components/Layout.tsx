import { Link, useLocation, useNavigate } from "react-router-dom";
import { Radar, LayoutGrid, Bell, AlertTriangle, Menu, X, Zap, Settings, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { isStale } from "@/lib/formatters";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { playGoAlert, requestNotificationPermission, showGoNotification } from "@/lib/notifications";
import { useNotificationSettings } from "@/hooks/useNotificationSettings";
import { useLanguage } from "@/i18n/LanguageContext";

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
    { to: "/", label: t("nav.radar"), icon: Radar },
    { to: "/subnets", label: t("nav.subnets"), icon: LayoutGrid },
    { to: "/alerts", label: t("nav.alerts"), icon: Bell },
    { to: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  useEffect(() => {
    const channel = supabase
      .channel("go-signals")
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, (payload) => {
        const row = payload.new as any;
        if (row?.state === "GO" || row?.state === "GO_SPECULATIVE" || row?.state === "BREAK") {
          supabase.from("subnets").select("name").eq("netuid", row.netuid).maybeSingle().then(({ data }) => {
            const name = data?.name || null;
            setGoBanner({ netuid: row.netuid, subnetName: name, score: row.score, state: row.state });
            if (soundEnabled) playGoAlert();
            if (pushEnabled) showGoNotification(name || `SN-${row.netuid}`, row.netuid, row.score);
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

  const { data: latestTs } = useQuery({
    queryKey: ["stale-check"],
    queryFn: async () => {
      const { data } = await supabase.from("subnet_metrics_ts").select("ts").order("ts", { ascending: false }).limit(1).single();
      return data?.ts || null;
    },
    refetchInterval: 30000,
  });

  const stale = isStale(latestTs);
  const isBreak = goBanner?.state === "BREAK";

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            {t("app.title")}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t("app.subtitle")}</p>
        </div>
        {isMobile && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
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

      <div className="p-3 border-t border-sidebar-border space-y-2">
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
          <div className="flex items-center gap-1.5 text-xs text-signal-exit">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{t("app.dataStale")}</span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex-col">
        {sidebarContent}
      </aside>

      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-10 w-64 bg-sidebar border-r border-sidebar-border flex flex-col animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </aside>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-1.5 text-center text-xs font-medium text-amber-400 tracking-wide flex items-center justify-center gap-2">
          {isMobile && (
            <Button variant="ghost" size="icon" className="h-6 w-6 absolute left-2" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-4 w-4 text-amber-400" />
            </Button>
          )}
          <span>{t("app.testMode")}</span>
        </div>

        {goBanner && (
          <div className={cn(
            "border-b px-4 py-2.5 flex items-center justify-center gap-3 animate-in slide-in-from-top duration-300",
            isBreak ? "bg-signal-exit/15 border-signal-exit/30" : "bg-signal-go/15 border-signal-go/30"
          )}>
            <Zap className={cn("h-4 w-4 flex-shrink-0", isBreak ? "text-signal-exit" : "text-signal-go")} />
            <span className={cn("text-sm font-medium", isBreak ? "text-signal-exit" : "text-signal-go")}>
              {isBreak ? "🔴" : "🚀"} {isBreak ? t("banner.breakSignal") : t("banner.goSignal")} — {goBanner.subnetName || `SN-${goBanner.netuid}`}
              {goBanner.score != null && <span className="ml-1 font-mono">(score {goBanner.score})</span>}
            </span>
            <Button
              variant="outline"
              size="sm"
              className={cn("text-xs ml-2", isBreak ? "border-signal-exit/40 text-signal-exit hover:bg-signal-exit/20" : "border-signal-go/40 text-signal-go hover:bg-signal-go/20")}
              onClick={() => { navigate(`/subnet/${goBanner.netuid}`); setGoBanner(null); }}
            >
              {t("banner.view")}
            </Button>
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
