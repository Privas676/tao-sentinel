import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { CurrencyProvider } from "@/hooks/useCurrency";
import GoRadar from "./pages/Index";
import SubnetsOverview from "./pages/SubnetsOverview";
import SubnetDetail from "./pages/SubnetDetail";
import Alerts from "./pages/Alerts";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <CurrencyProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<GoRadar />} />
              <Route path="/subnets" element={<SubnetsOverview />} />
              <Route path="/subnet/:netuid" element={<SubnetDetail />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </CurrencyProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
