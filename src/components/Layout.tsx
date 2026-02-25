import { Link, useLocation, useNavigate } from "react-router-dom";
import { Radar, LayoutGrid, Bell, AlertTriangle, Menu, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { isStale } from "@/lib/formatters";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const NAV = [
  { to: "/", label: "GO Radar", icon: Radar },
  { to: "/subnets", label: "Subnets", icon: LayoutGrid },
  { to: "/alerts", label: "Alerts", icon: Bell },
];

type GoBanner = { netuid: number; subnetName: string | null; score: number | null } | null;

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { currency, toggleCurrency } = useCurrency();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [goBanner, setGoBanner] = useState<GoBanner>(null);

  // Subscribe to realtime GO signals
  useEffect(() => {
    const channel = supabase
      .channel("go-signals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "signals" },
        (payload) => {
          const row = payload.new as any;
          if (row?.state === "GO" || row?.state === "GO_SPECULATIVE") {
            // Fetch subnet name
            supabase
              .from("subnets")
              .select("name")
              .eq("netuid", row.netuid)
              .maybeSingle()
              .then(({ data }) => {
                setGoBanner({
                  netuid: row.netuid,
                  subnetName: data?.name || null,
                  score: row.score,
                });
              });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Auto-dismiss banner after 30s
  useEffect(() => {
    if (!goBanner) return;
    const timer = setTimeout(() => setGoBanner(null), 30000);
    return () => clearTimeout(timer);
  }, [goBanner]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const { data: latestTs } = useQuery({
    queryKey: ["stale-check"],
    queryFn: async () => {
      const { data } = await supabase
        .from("subnet_metrics_ts")
        .select("ts")
        .order("ts", { ascending: false })
        .limit(1)
        .single();
      return data?.ts || null;
    },
    refetchInterval: 30000,
  });

  const stale = isStale(latestTs);

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            TAO Sentinel
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Alpha Detection</p>
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
        <Button
          variant="outline"
          size="sm"
          className="w-full font-mono text-xs"
          onClick={toggleCurrency}
        >
          {currency === "USD" ? "$ USD" : "τ TAO"}
        </Button>

        {stale && (
          <div className="flex items-center gap-1.5 text-xs text-signal-exit">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Data stale</span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile overlay sidebar */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-10 w-64 bg-sidebar border-r border-sidebar-border flex flex-col animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-1.5 text-center text-xs font-medium text-amber-400 tracking-wide flex items-center justify-center gap-2">
          {isMobile && (
            <Button variant="ghost" size="icon" className="h-6 w-6 absolute left-2" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-4 w-4 text-amber-400" />
            </Button>
          )}
          <span>TEST MODE – Data refresh every 5 minutes</span>
        </div>
        {/* GO Signal Banner */}
        {goBanner && (
          <div className="bg-signal-go/15 border-b border-signal-go/30 px-4 py-2.5 flex items-center justify-center gap-3 animate-in slide-in-from-top duration-300">
            <Zap className="h-4 w-4 text-signal-go flex-shrink-0" />
            <span className="text-sm font-medium text-signal-go">
              🚀 GO Signal — {goBanner.subnetName || `SN-${goBanner.netuid}`}
              {goBanner.score != null && <span className="ml-1 font-mono">(score {goBanner.score})</span>}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-signal-go/40 text-signal-go hover:bg-signal-go/20 ml-2"
              onClick={() => {
                navigate(`/subnet/${goBanner.netuid}`);
                setGoBanner(null);
              }}
            >
              View
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-1 text-signal-go/70 hover:text-signal-go"
              onClick={() => setGoBanner(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
