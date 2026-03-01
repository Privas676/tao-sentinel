import { describe, it, expect, vi } from "vitest";
// @ts-expect-error -- @testing-library/dom types re-exported at runtime
import { render, screen, fireEvent } from "@testing-library/react";
import MarketContextPanel from "@/components/MarketContextPanel";
import { type SourceMetrics } from "@/lib/data-fusion";

const baseTmc: SourceMetrics = {
  netuid: 1,
  price: 0.05432,
  cap: 250000,
  vol24h: 12500,
  liquidity: 8500,
  ts: new Date().toISOString(),
  source: "taomarketcap",
};

describe("MarketContextPanel", () => {
  it("renders header with netuid and name", () => {
    render(<MarketContextPanel netuid={7} name="TestNet" tmc={baseTmc} onClose={() => {}} />);
    expect(screen.getByText(/MARKET CONTEXT — SN-7 TestNet/)).toBeInTheDocument();
  });

  it("shows TMC data rows when tmc is provided", () => {
    render(<MarketContextPanel netuid={1} name="Alpha" tmc={baseTmc} onClose={() => {}} />);
    expect(screen.getByText("Prix (TMC)")).toBeInTheDocument();
    expect(screen.getByText("Volume 24h (TMC)")).toBeInTheDocument();
    expect(screen.getByText("Market Cap (TMC)")).toBeInTheDocument();
    expect(screen.getByText("Liquidité (TMC)")).toBeInTheDocument();
  });

  it("shows 'TMC unavailable' when tmc is undefined", () => {
    render(<MarketContextPanel netuid={1} name="Alpha" tmc={undefined} onClose={() => {}} />);
    expect(screen.getByText("TMC unavailable")).toBeInTheDocument();
  });

  it("formats large values with K/M suffix", () => {
    render(<MarketContextPanel netuid={1} name="A" tmc={baseTmc} onClose={() => {}} />);
    expect(screen.getByText("250.0K τ")).toBeInTheDocument(); // cap
    expect(screen.getByText("12.5K τ")).toBeInTheDocument(); // vol24h
  });

  it("formats price with 6 decimals", () => {
    render(<MarketContextPanel netuid={1} name="A" tmc={baseTmc} onClose={() => {}} />);
    expect(screen.getByText("0.054320 τ")).toBeInTheDocument();
  });

  it("shows dash for null values", () => {
    const tmc: SourceMetrics = { ...baseTmc, price: null, vol24h: null, cap: null, liquidity: null };
    render(<MarketContextPanel netuid={1} name="A" tmc={tmc} onClose={() => {}} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<MarketContextPanel netuid={1} name="A" tmc={baseTmc} onClose={onClose} />);
    fireEvent.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<MarketContextPanel netuid={1} name="A" tmc={baseTmc} onClose={onClose} />);
    // Click the outermost fixed div (backdrop)
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT call onClose when panel content clicked", () => {
    const onClose = vi.fn();
    render(<MarketContextPanel netuid={1} name="A" tmc={baseTmc} onClose={onClose} />);
    fireEvent.click(screen.getByText("Prix (TMC)"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows TaoMarketCap source label", () => {
    render(<MarketContextPanel netuid={1} name="A" tmc={baseTmc} onClose={() => {}} />);
    expect(screen.getByText("TaoMarketCap")).toBeInTheDocument();
  });

  it("shows disclaimer text", () => {
    render(<MarketContextPanel netuid={1} name="A" tmc={baseTmc} onClose={() => {}} />);
    expect(screen.getByText(/does not affect risk score/)).toBeInTheDocument();
  });

  it("formats million values with M suffix", () => {
    const bigTmc: SourceMetrics = { ...baseTmc, cap: 2_500_000 };
    render(<MarketContextPanel netuid={1} name="A" tmc={bigTmc} onClose={() => {}} />);
    expect(screen.getByText("2.5M τ")).toBeInTheDocument();
  });

  it("formats small values with 2 decimals", () => {
    const smallTmc: SourceMetrics = { ...baseTmc, liquidity: 42.5 };
    render(<MarketContextPanel netuid={1} name="A" tmc={smallTmc} onClose={() => {}} />);
    expect(screen.getByText("42.50 τ")).toBeInTheDocument();
  });
});
