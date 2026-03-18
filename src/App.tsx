import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
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
import SocialSettingsPage from "./pages/SocialSettingsPage";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateBanner } from "@/components/UpdateBanner";

const queryClient = new QueryClient();

function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6">
      <div className="text-center space-y-3">
        <h1 className="font-mono text-xs tracking-[0.16em] uppercase text-foreground/80">Page introuvable</h1>
        <p className="font-mono text-[10px] text-muted-foreground">Cette route n’existe pas ou n’est plus disponible.</p>
        <Link to="/compass" className="inline-block font-mono text-[10px] px-3 py-2 rounded-md border border-border hover:bg-muted/30 transition-colors">
          Retour à Compass
        </Link>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <AppShell>
      <ErrorBoundary fallbackTitle="Erreur critique">
        <Routes>
          <Route path="/compass" element={<ErrorBoundary fallbackTitle="Compass"><CompassPage /></ErrorBoundary>} />
          <Route path="/subnets" element={<ErrorBoundary fallbackTitle="Subnets"><SubnetsPage /></ErrorBoundary>} />
          <Route path="/subnets/:id" element={<ErrorBoundary fallbackTitle="Subnet Detail"><SubnetDetailPage /></ErrorBoundary>} />
          <Route path="/portfolio" element={<ErrorBoundary fallbackTitle="Portfolio"><PortfolioPage /></ErrorBoundary>} />
          <Route path="/alerts" element={<ErrorBoundary fallbackTitle="Alerts"><AlertsPage /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary fallbackTitle="Settings"><SettingsPage /></ErrorBoundary>} />
          <Route path="/lab" element={<ErrorBoundary fallbackTitle="Lab"><LabPage /></ErrorBoundary>} />
          <Route path="/auth" element={user ? <Navigate to="/compass" replace /> : <AuthPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/install" element={<InstallPage />} />
          <Route path="/settings/social" element={<ErrorBoundary fallbackTitle="Social Settings"><SocialSettingsPage /></ErrorBoundary>} />
          <Route path="/" element={<Navigate to="/compass" replace />} />
          <Route path="/methodology" element={<Navigate to="/lab" replace />} />
          <Route path="/quant-diagnostics" element={<Navigate to="/lab" replace />} />
          <Route path="/radar" element={<Navigate to="/lab" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <I18nProvider>
        <TooltipProvider delayDuration={200}>
          <ErrorBoundary fallbackTitle="Boot">
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </I18nProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
