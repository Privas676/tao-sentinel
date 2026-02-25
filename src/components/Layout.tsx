import { Link, useLocation } from "react-router-dom";
import { Radar, LayoutGrid, Bell, AlertTriangle, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { isStale } from "@/lib/formatters";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const NAV = [
  { to: "/", label: "GO Radar", icon: Radar },
  { to: "/subnets", label: "Subnets", icon: LayoutGrid },
  { to: "/alerts", label: "Alerts", icon: Bell },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { currency, toggleCurrency } = useCurrency();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        {children}
      </main>
    </div>
  );
}
