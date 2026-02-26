import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { CurrencyProvider } from "@/hooks/useCurrency";
import { NotificationSettingsProvider } from "@/hooks/useNotificationSettings";
import { LanguageProvider } from "@/i18n/LanguageContext";
import SentinelCockpit from "./pages/Index";
import SubnetsOverview from "./pages/SubnetsOverview";
import SubnetDetail from "./pages/SubnetDetail";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";
import AlienGauge from "./pages/AlienGauge";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const { pathname } = useLocation();
  const isGauge = pathname === "/gauge";

  if (isGauge) return <AlienGauge />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<SentinelCockpit />} />
        <Route path="/subnets" element={<SubnetsOverview />} />
        <Route path="/subnet/:netuid" element={<SubnetDetail />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LanguageProvider>
        <CurrencyProvider>
          <NotificationSettingsProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </NotificationSettingsProvider>
        </CurrencyProvider>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
