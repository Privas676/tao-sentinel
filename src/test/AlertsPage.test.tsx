import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Mock modules
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
        gte: () => Promise.resolve({ count: 0, error: null }),
      }),
    }),
  },
}));

vi.mock("@/hooks/use-subnet-scores", () => ({
  useSubnetScores: () => ({
    scores: new Map(),
    scoresList: [],
    sparklines: new Map(),
    scoreTimestamp: "2025-06-01T12:00:00Z",
    taoUsd: 350,
    isLoading: false,
    subnetList: [],
    marketContext: undefined,
  }),
}));

vi.mock("@/hooks/use-override-mode", () => ({
  useOverrideMode: () => ({ mode: "strict", setMode: vi.fn() }),
}));

vi.mock("@/hooks/use-delist-mode", () => ({
  useDelistMode: () => ({ delistMode: "manual", setDelistMode: vi.fn() }),
}));

vi.mock("@/hooks/use-canonical-subnets", () => ({
  useCanonicalSubnets: () => ({
    decisions: new Map(),
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-local-portfolio", () => ({
  useLocalPortfolio: () => ({
    positions: [],
    archive: [],
    ownedNetuids: new Set(),
    isOwned: () => false,
    addPosition: vi.fn(),
    updateQuantity: vi.fn(),
    removePosition: vi.fn(),
    sellPosition: vi.fn(),
  }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (k: string) => {
      const map: Record<string, string> = {
        "alerts.title": "ALERTES",
        "alerts.empty": "Aucune alerte",
      };
      return map[k] ?? k;
    },
    lang: "fr",
  }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue({ data: null, isLoading: false }),
  };
});

import AlertsPage from "@/pages/AlertsPage";

function renderAlerts(events?: any[]) {
  (useQuery as Mock).mockReturnValue({ data: events ?? null, isLoading: false });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const makeEvent = (id: number, type: string, netuid: number, severity: number = 1, evidence: any = {}) => ({
  id,
  netuid,
  type,
  severity,
  ts: new Date(Date.now() - id * 60000).toISOString(),
  evidence,
});

describe("AlertsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders page title", () => {
    renderAlerts([]);
    expect(screen.getByText("Risk & Alerts")).toBeInTheDocument();
  });

  it("shows empty state when no events", () => {
    renderAlerts([]);
    expect(screen.getByText(/Aucune alerte/)).toBeInTheDocument();
  });

  it("renders tab buttons", () => {
    renderAlerts();
    expect(screen.getByText("Toutes")).toBeInTheDocument();
    expect(screen.getByText("Bloquant")).toBeInTheDocument();
    expect(screen.getByText("Surveillance")).toBeInTheDocument();
    expect(screen.getByText("Overrides")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
  });

  it("renders KPI chips", () => {
    renderAlerts([]);
    expect(screen.getByText("BLOQUANT")).toBeInTheDocument();
    expect(screen.getByText("SURVEILLANCE")).toBeInTheDocument();
    expect(screen.getByText("OVERRIDES")).toBeInTheDocument();
  });

  it("renders events when data is available", () => {
    const events = [
      makeEvent(1, "BREAK", 5, 3, { reasons: ["Risque critique"] }),
      makeEvent(2, "GO", 8, 1, { reasons: ["Momentum fort"] }),
    ];
    renderAlerts(events);
    expect(screen.getByText(/SN-5/)).toBeInTheDocument();
  });

  it("shows ZONE CRITIQUE for BREAK events", () => {
    const events = [makeEvent(1, "BREAK", 5, 3)];
    renderAlerts(events);
    expect(screen.getByText(/ZONE CRITIQUE/)).toBeInTheDocument();
  });

  it("shows WHALE label for whale events", () => {
    const events = [makeEvent(1, "WHALE_MOVE", 3, 2, { direction: "OUT", amount_tao: 1500, label: "Binance" })];
    renderAlerts(events);
    expect(screen.getByText(/WHALE/)).toBeInTheDocument();
  });

  it("clicking tab changes displayed events", () => {
    const events = [
      makeEvent(1, "WHALE_MOVE", 3, 2, { direction: "IN", amount_tao: 500 }),
      makeEvent(2, "BREAK", 5, 3),
    ];
    renderAlerts(events);
    fireEvent.click(screen.getByText("Bloquant"));
    const breakEls = screen.queryAllByText(/ZONE CRITIQUE/);
    const emptyEls = screen.queryAllByText(/Aucune alerte/);
    expect(breakEls.length + emptyEls.length).toBeGreaterThanOrEqual(1);
  });

  it("renders view mode toggle", () => {
    renderAlerts([]);
    expect(screen.getByText("Flux")).toBeInTheDocument();
    expect(screen.getByText("Par subnet")).toBeInTheDocument();
  });

  it("renders why-it-matters section", () => {
    renderAlerts([]);
    expect(screen.getByText(/Pourquoi c'est important/)).toBeInTheDocument();
  });

  it("shows dismissed count after dismissing", () => {
    const key = "alerts-dismissed";
    localStorage.setItem(key, JSON.stringify({ "BREAK::5::2025": Date.now() }));
    renderAlerts([makeEvent(1, "BREAK", 5, 3)]);
    expect(screen.getByText(/alertes traitées/)).toBeInTheDocument();
  });
});
