import { useLocation } from "react-router-dom";
import { NavLink } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { t, lang } = useI18n();
  const { user, signOut } = useAuth();

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

  const mainNav = [
    { path: "/", label: t("nav.gauge"), icon: "◎", end: true },
    { path: "/subnets", label: t("nav.subnets"), icon: "⊞" },
    { path: "/portfolio", label: t("nav.portfolio"), icon: "💼" },
    { path: "/alerts", label: t("nav.alerts"), icon: "⚡", badge: unreadCount },
    { path: "/radar", label: "Radar", icon: "📡" },
  ];

  const secondaryNav = [
    { path: "/settings", label: t("nav.settings"), icon: "⚙" },
    { path: "/methodology", label: lang === "fr" ? "Méthodologie" : "Methodology", icon: "📖" },
    { path: "/install", label: "Installer", icon: "📲" },
  ];

  const isActive = (path: string, end?: boolean) => {
    if (end) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="pt-4 pb-2">
        <div className="flex items-center gap-2 px-2">
          <span className="text-lg">◎</span>
          {!collapsed && (
            <span className="font-mono text-xs font-bold tracking-widest text-sidebar-foreground/80 uppercase">
              TAO Sentinel
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Main navigation */}
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[9px] tracking-widest uppercase text-sidebar-foreground/40">
            {!collapsed ? "Navigation" : ""}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.path, item.end)}
                    tooltip={item.label}
                  >
                    <NavLink to={item.path} end={item.end}>
                      <span className="text-sm">{item.icon}</span>
                      <span className="font-mono text-xs tracking-wider">{item.label}</span>
                      {item.badge != null && item.badge > 0 && (
                        <span
                          className="ml-auto font-mono text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive"
                        >
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Secondary */}
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[9px] tracking-widest uppercase text-sidebar-foreground/40">
            {!collapsed ? "Outils" : ""}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryNav.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.path)}
                    tooltip={item.label}
                  >
                    <NavLink to={item.path}>
                      <span className="text-sm">{item.icon}</span>
                      <span className="font-mono text-xs tracking-wider">{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="pb-4">
        <SidebarMenu>
          <SidebarMenuItem>
            {user ? (
              <div className="space-y-1 px-2">
                <SidebarMenuButton asChild tooltip={user.email ?? "Profile"}>
                  <NavLink to="/profile">
                    <span className="text-sm">👤</span>
                    {!collapsed && (
                      <span className="font-mono text-[10px] text-sidebar-foreground/50 truncate">
                        {user.email}
                      </span>
                    )}
                  </NavLink>
                </SidebarMenuButton>
                {!collapsed && (
                  <button
                    onClick={signOut}
                    className="font-mono text-[10px] tracking-wider text-sidebar-foreground/30 hover:text-sidebar-foreground/60 transition-colors px-2"
                  >
                    {t("auth.logout")}
                  </button>
                )}
              </div>
            ) : (
              <SidebarMenuButton asChild tooltip="Connexion">
                <NavLink to="/auth">
                  <span className="text-sm">🔒</span>
                  {!collapsed && (
                    <span className="font-mono text-[10px] tracking-wider">Connexion</span>
                  )}
                </NavLink>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
