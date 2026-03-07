import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import AlienGauge from "./pages/AlienGauge";
import SubnetsPage from "./pages/SubnetsPage";
import AlertsPage from "./pages/AlertsPage";
import SettingsPage from "./pages/SettingsPage";
import AuthPage from "./pages/AuthPage";
import PortfolioPage from "./pages/PortfolioPage";
import InstallPage from "./pages/InstallPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";
import MethodologyPage from "./pages/MethodologyPage";
import QuantDiagnosticsPage from "./pages/QuantDiagnosticsPage";
import RadarPage from "./pages/RadarPage";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();

function AppLayout() {
  const { user } = useAuth();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b border-border/40 px-2 flex-shrink-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
          </header>

          <main className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<AlienGauge />} />
              <Route path="/subnets" element={<SubnetsPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/radar" element={<RadarPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/methodology" element={<MethodologyPage />} />
              <Route path="/install" element={<InstallPage />} />
              <Route path="/auth" element={user ? <AlienGauge /> : <AuthPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/quant-diagnostics" element={<QuantDiagnosticsPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <I18nProvider>
        <TooltipProvider delayDuration={200}>
          <BrowserRouter>
            <AppLayout />
          </BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </I18nProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
