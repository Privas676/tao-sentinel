import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Link } from "react-router-dom";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import AlienGauge from "./pages/AlienGauge";
import SubnetsPage from "./pages/SubnetsPage";
import AlertsPage from "./pages/AlertsPage";
import SettingsPage from "./pages/SettingsPage";
import AuthPage from "./pages/AuthPage";
import PortfolioPage from "./pages/PortfolioPage";
import InstallPage from "./pages/InstallPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import { Toaster } from "@/components/ui/sonner";

const queryClient = new QueryClient();

function AppLayout() {
  const location = useLocation();
  const { t } = useI18n();
  const { user, loading, signOut } = useAuth();
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

  const navItems = [
    { path: "/", label: t("nav.gauge"), icon: "◎" },
    { path: "/subnets", label: t("nav.subnets"), icon: "⊞" },
    { path: "/portfolio", label: t("nav.portfolio"), icon: "💼" },
    { path: "/alerts", label: t("nav.alerts"), icon: "⚡", badge: unreadCount },
    { path: "/settings", label: t("nav.settings"), icon: "⚙" },
    { path: "/install", label: "Installer", icon: "📲" },
  ];

  const SIDEBAR_W = 200;

  return (
    <div className="h-screen w-screen flex bg-black overflow-hidden">
      {/* Sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-50 flex items-center gap-2 px-3.5 py-2.5 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: sidebarOpen ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.06)",
          color: sidebarOpen ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.5)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(10px)",
          boxShadow: "0 0 12px rgba(255,215,0,0.04)",
        }}
      >
        <span className="font-mono text-sm">{sidebarOpen ? "✕" : "☰"}</span>
        <span className="font-mono text-[11px] tracking-wider uppercase font-semibold" style={{ opacity: 0.8 }}>Menu</span>
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — overlay on mobile, pushes content on desktop */}
      <div
        className={`fixed md:relative z-40 h-full transition-all duration-300 ease-in-out flex-shrink-0 ${
          sidebarOpen ? "translate-x-0 md:translate-x-0" : "-translate-x-full md:translate-x-0 md:-ml-[200px]"
        }`}
        style={{ width: SIDEBAR_W }}
      >
        <nav className="h-full border-r border-white/[0.04] pt-16 px-3 flex flex-col gap-1"
          style={{ background: "rgba(5,5,8,0.98)", width: SIDEBAR_W }}>
          {navItems.map(item => {
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path}
                onClick={() => setSidebarOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-mono text-xs tracking-wider"
                style={{
                  background: active ? "rgba(255,255,255,0.06)" : "transparent",
                  color: active ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)",
                }}>
                <span className="text-sm">{item.icon}</span>
                <span>{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span className="ml-auto font-mono text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(229,57,53,0.2)", color: "rgba(229,57,53,0.8)" }}>
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}

          <div className="mt-auto mb-4 px-3">
            {user ? (
              <div className="space-y-2">
                <div className="font-mono text-[9px] text-white/25 truncate">{user.email}</div>
                <button
                  onClick={() => { signOut(); setSidebarOpen(false); }}
                  className="font-mono text-[10px] tracking-wider text-white/30 hover:text-white/60 transition-colors"
                >
                  {t("auth.logout")}
                </button>
              </div>
            ) : (
              <Link
                to="/auth"
                onClick={() => setSidebarOpen(false)}
                className="font-mono text-[10px] tracking-wider text-white/30 hover:text-white/60 transition-colors"
              >
                Connexion
              </Link>
            )}
          </div>
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 h-full overflow-hidden transition-all duration-300">
        <Routes>
          <Route path="/" element={<AlienGauge />} />
          <Route path="/subnets" element={<SubnetsPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/auth" element={user ? <AlienGauge /> : <AuthPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/install" element={<InstallPage />} />
        </Routes>
      </div>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <I18nProvider>
        <BrowserRouter>
          <AppLayout />
        </BrowserRouter>
        <Toaster />
      </I18nProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
