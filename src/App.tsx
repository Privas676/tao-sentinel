import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import AppShell from "@/components/AppShell";
import CompassPage from "./pages/CompassPage";
import SubnetsPage from "./pages/SubnetsPage";
import SubnetDetailPage from "./pages/SubnetDetailPage";
import AlertsPage from "./pages/AlertsPage";
import SettingsPage from "./pages/SettingsPage";
import AuthPage from "./pages/AuthPage";
import PortfolioPage from "./pages/PortfolioPage";
import LabPage from "./pages/LabPage";
import InstallPage from "./pages/InstallPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

function AppRoutes() {
  const { user } = useAuth();

  return (
    <AppShell>
      <Routes>
        {/* ── Core decision pages ── */}
        <Route path="/compass" element={<CompassPage />} />
        <Route path="/subnets" element={<SubnetsPage />} />
        <Route path="/subnets/:id" element={<SubnetDetailPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/alerts" element={<AlertsPage />} />

        {/* ── Utility ── */}
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/lab" element={<LabPage />} />

        {/* ── Auth ── */}
        <Route path="/auth" element={user ? <Navigate to="/compass" replace /> : <AuthPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/install" element={<InstallPage />} />

        {/* ── Legacy redirects ── */}
        <Route path="/" element={<Navigate to="/compass" replace />} />
        <Route path="/methodology" element={<Navigate to="/lab" replace />} />
        <Route path="/quant-diagnostics" element={<Navigate to="/lab" replace />} />
        <Route path="/radar" element={<Navigate to="/lab" replace />} />
      </Routes>
    </AppShell>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <I18nProvider>
        <TooltipProvider delayDuration={200}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </I18nProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
