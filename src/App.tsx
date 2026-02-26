import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AlienGauge from "./pages/AlienGauge";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AlienGauge />
  </QueryClientProvider>
);

export default App;
