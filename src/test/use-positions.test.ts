import { describe, it, expect } from "vitest";
import type { DbPosition } from "@/hooks/use-positions";

describe("DbPosition type shape", () => {
  it("has required fields for open position", () => {
    const pos: DbPosition = {
      id: "abc-123",
      user_id: "user-1",
      netuid: 5,
      capital: 1000,
      entry_price: 0.05,
      quantity: 20000,
      stop_loss_pct: 10,
      take_profit_pct: 25,
      status: "open",
      closed_at: null,
      closed_price: null,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    expect(pos.status).toBe("open");
    expect(pos.closed_at).toBeNull();
    expect(pos.quantity).toBe(pos.capital / pos.entry_price);
  });

  it("closed position has closed_at and closed_price", () => {
    const pos: DbPosition = {
      id: "abc-456",
      user_id: "user-1",
      netuid: 5,
      capital: 1000,
      entry_price: 0.05,
      quantity: 20000,
      stop_loss_pct: 10,
      take_profit_pct: 25,
      status: "closed",
      closed_at: "2025-02-01T00:00:00Z",
      closed_price: 0.08,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-02-01T00:00:00Z",
    };
    expect(pos.status).toBe("closed");
    expect(pos.closed_at).not.toBeNull();
    expect(pos.closed_price).toBe(0.08);
  });

  it("quantity = capital / entry_price (business rule)", () => {
    const capital = 500;
    const entryPrice = 0.025;
    const quantity = capital / entryPrice;
    expect(quantity).toBe(20000);
  });

  it("PnL calculation: (closed_price - entry_price) * quantity", () => {
    const entry = 0.05;
    const closed = 0.08;
    const quantity = 1000 / entry; // 20000
    const pnl = (closed - entry) * quantity;
    expect(pnl).toBe(600);
  });

  it("stop loss triggers at entry * (1 - stop_loss_pct/100)", () => {
    const entry = 0.10;
    const slPct = 15;
    const slPrice = entry * (1 - slPct / 100);
    expect(slPrice).toBeCloseTo(0.085);
  });

  it("take profit triggers at entry * (1 + take_profit_pct/100)", () => {
    const entry = 0.10;
    const tpPct = 30;
    const tpPrice = entry * (1 + tpPct / 100);
    expect(tpPrice).toBeCloseTo(0.13);
  });
});
