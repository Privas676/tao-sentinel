import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { APP_VERSION, BUILD_TAG } from "@/lib/version";

/* ═══════════════════════════════════════ */
/*     APP SHELL — TAO SENTINEL v4         */
/*     Premium Dark Institutional Layout   */
/* ═══════════════════════════════════════ */

type NavItem = {
  path: string;
  label: string;
  icon: string;
  badge?: number;
  end?: boolean;
};

const PAGE_TITLES: Record<string, { fr: string; en: string }> = {
  "/compass": { fr: "Compass", en: "Compass" },
  "/subnets": { fr: "Subnets", en: "Subnets" },
  "/portfolio": { fr: "Portefeuille", en: "Portfolio" },
  "/alerts": { fr: "Alertes", en: "Alerts" },
  "/settings": { fr: "Réglages", en: "Settings" },
  "/lab": { fr: "Laboratoire", en: "Lab" },
};

function getPageTitle(pathname: string, lang: string): string {
  // Handle /subnets/:id
  if (pathname.startsWith("/subnets/")) {
    const id = pathname.split("/")[2];
    return `Subnet #${id}`;
  }
  const entry = PAGE_TITLES[pathname];
  if (entry) return lang === "fr" ? entry.fr : entry.en;
  return "TAO Sentinel";
}

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { t, lang } = useI18n();
  const { user, signOut } = useAuth();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: unreadCount } = useQuery({
    queryKey: ["unread-events"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600000).toISOString();
      const { count, error } = await supabase
        .from("events")
        .select("*", { count: "exact", head: true })
        .gte("ts", since);
      if (error) return 0;
      return count || 0;
    },
    refetchInterval: 60_000,
  });

  const navItems: NavItem[] = [
    { path: "/compass", label: "Compass", icon: "◎", end: true },
    { path: "/subnets", label: "Subnets", icon: "⊞" },
    { path: "/portfolio", label: lang === "fr" ? "Portefeuille" : "Portfolio", icon: "💼" },
    { path: "/alerts", label: lang === "fr" ? "Alertes" : "Alerts", icon: "⚡", badge: unreadCount ?? 0 },
    { path: "/lab", label: "Lab", icon: "🔬" },
    { path: "/settings", label: lang === "fr" ? "Réglages" : "Settings", icon: "⚙" },
  ];

  const isActive = (path: string, end?: boolean) => {
    if (end) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const pageTitle = getPageTitle(location.pathname, lang);

  const SIDEBAR_W = 220;

  return (
    <div className="h-screen w-screen flex bg-background overflow-hidden">
      {/* ── MOBILE OVERLAY ── */}
      {sidebarOpen && isMobile && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── SIDEBAR ── */}
      <aside
        className={`fixed md:relative z-50 h-full flex-shrink-0 transition-transform duration-300 ease-in-out ${
          sidebarOpen || !isMobile ? "translate-x-0" : "-translate-x-full"
        } ${!sidebarOpen && !isMobile ? "md:-translate-x-full md:-ml-[220px]" : ""}`}
        style={{ width: SIDEBAR_W }}
      >
        <nav
          className="h-full flex flex-col border-r"
          style={{
            width: SIDEBAR_W,
            background: "linear-gradient(180deg, hsl(0 0% 4.5%) 0%, hsl(0 0% 3%) 100%)",
            borderColor: "hsla(0,0%,100%,0.05)",
          }}
        >
          {/* ─ Brand ─ */}
          <div className="pt-6 pb-5 px-5 flex items-center gap-3">
            <span
              className="text-lg"
              style={{ color: "hsl(var(--gold))", filter: "drop-shadow(0 0 8px hsla(40,70%,69%,0.25))" }}
            >
              ◎
            </span>
            <div className="flex flex-col">
              <span
                className="font-mono text-[10px] font-bold tracking-[0.22em] uppercase"
                style={{ color: "hsl(var(--gold))" }}
              >
                TAO Sentinel
              </span>
              <span className="font-mono text-[7px] tracking-[0.15em] uppercase text-muted-foreground mt-0.5" style={{ opacity: 0.5 }}>
                Intelligence Terminal
              </span>
            </div>
          </div>

          {/* ─ Separator ─ */}
          <div className="mx-5 mb-3" style={{ height: 1, background: "hsla(0,0%,100%,0.04)" }} />

          {/* ─ Nav items ─ */}
          <div className="flex-1 px-3 space-y-0.5 overflow-y-auto">
            {navItems.map((item) => {
              const active = isActive(item.path, item.end);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => isMobile && setSidebarOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group"
                  style={{
                    background: active
                      ? "hsla(40,70%,69%,0.06)"
                      : "transparent",
                    borderLeft: active ? "2px solid hsl(var(--gold))" : "2px solid transparent",
                  }}
                >
                  <span className="text-sm w-5 text-center" style={{ opacity: active ? 0.85 : 0.4 }}>
                    {item.icon}
                  </span>
                  <span
                    className="font-mono text-[10.5px] tracking-[0.08em]"
                    style={{
                      color: active ? "hsl(var(--gold))" : "hsl(var(--sidebar-foreground))",
                      opacity: active ? 1 : 0.55,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {item.label}
                  </span>
                  {item.badge != null && item.badge > 0 && (
                    <span
                      className="ml-auto font-mono text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{
                        background: "hsla(var(--destructive), 0.12)",
                        color: "hsl(var(--destructive))",
                        border: "1px solid hsla(var(--destructive), 0.2)",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* ─ Footer: user ─ */}
          <div className="px-4 pb-4 pt-2">
            <div className="mx-1 mb-3" style={{ height: 1, background: "hsl(var(--sidebar-border))" }} />
            {user ? (
              <div className="space-y-2">
                <Link
                  to="/profile"
                  onClick={() => isMobile && setSidebarOpen(false)}
                  className="flex items-center gap-2 px-1 group"
                >
                  <span className="text-sm opacity-50 group-hover:opacity-80 transition-opacity">👤</span>
                  <span className="font-mono text-[9px] text-muted-foreground group-hover:text-foreground/80 transition-colors truncate">
                    {user.email}
                  </span>
                </Link>
                <button
                  onClick={() => {
                    signOut();
                    isMobile && setSidebarOpen(false);
                  }}
                  className="font-mono text-[9px] tracking-wider text-muted-foreground hover:text-foreground/80 transition-colors px-1"
                >
                  {t("auth.logout")}
                </button>
              </div>
            ) : (
              <Link
                to="/auth"
                onClick={() => isMobile && setSidebarOpen(false)}
                className="flex items-center gap-2 px-1 font-mono text-[10px] tracking-wider text-muted-foreground hover:text-foreground/80 transition-colors"
              >
                <span>🔒</span>
                <span>Connexion</span>
              </Link>
            )}
          </div>
        </nav>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="flex-1 flex flex-col h-full min-w-0 transition-all duration-300">
        {/* ─ TOPBAR ─ */}
        <header
          className="h-11 flex items-center gap-3 px-4 flex-shrink-0 border-b"
          style={{
            background: "hsla(0,0%,5%,0.97)",
            borderColor: "hsla(0,0%,100%,0.04)",
            backdropFilter: "blur(16px)",
          }}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center justify-center w-7 h-7 rounded-md transition-all hover:scale-105 active:scale-95"
            style={{
              background: sidebarOpen ? "hsla(var(--gold), 0.06)" : "transparent",
              color: sidebarOpen ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
            }}
          >
            <span className="font-mono text-xs">{sidebarOpen ? "✕" : "☰"}</span>
          </button>

          {/* Page title */}
          <h1
            className="font-mono text-[11px] tracking-[0.18em] uppercase font-semibold truncate"
            style={{ color: "hsl(var(--gold))", opacity: 0.75 }}
          >
            {pageTitle}
          </h1>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            <span
              className="font-mono text-[7px] tracking-[0.12em] text-muted-foreground hidden sm:inline"
              style={{ opacity: 0.4 }}
            >
              v4.0
            </span>
          </div>
        </header>

        {/* ─ CONTENT AREA ─ */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
