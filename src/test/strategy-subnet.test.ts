import { describe, it, expect } from "vitest";
import {
  deriveStrategicAction,
  deriveStrategicActionMicro,
  deriveSubnetAction,
} from "@/lib/strategy-subnet";

describe("deriveStrategicAction", () => {
  it("EXIT when risk > exitRisk", () => {
    expect(deriveStrategicAction(80, 75, "STABLE", 80)).toBe("EXIT");
  });
  it("EXIT when DISTRIBUTION", () => {
    expect(deriveStrategicAction(80, 30, "DISTRIBUTION", 80)).toBe("EXIT");
  });
  it("ENTER when all conditions met (hunter)", () => {
    expect(deriveStrategicAction(60, 30, "ACCUMULATION", 50, "hunter", 70)).toBe("ENTER");
  });
  it("ENTER requires stability > 65", () => {
    expect(deriveStrategicAction(60, 30, "ACCUMULATION", 50, "hunter", 50)).not.toBe("ENTER");
  });
  it("WATCH for moderate conditions", () => {
    expect(deriveStrategicAction(50, 40, "STABLE", 50)).toBe("WATCH");
  });
  it("defensive mode has stricter thresholds", () => {
    // hunter would ENTER, defensive should not
    expect(deriveStrategicAction(60, 30, "ACCUMULATION", 50, "defensive", 70)).not.toBe("ENTER");
  });
  it("bagbuilder mode intermediate thresholds", () => {
    expect(deriveStrategicAction(65, 30, "ACCUMULATION", 55, "bagbuilder", 70)).toBe("ENTER");
  });
});

describe("deriveStrategicActionMicro", () => {
  it("EXIT when risk > exitRisk", () => {
    expect(deriveStrategicActionMicro(50, 75, "STABLE", 70)).toBe("EXIT");
  });
  it("ENTER for high asMicro + low risk + ACCUMULATION + stability", () => {
    expect(deriveStrategicActionMicro(30, 30, "ACCUMULATION", 70)).toBe("ENTER");
  });
  it("WATCH for moderate asMicro", () => {
    expect(deriveStrategicActionMicro(15, 40, "STABLE", 70)).toBe("WATCH");
  });
});

describe("deriveSubnetAction", () => {
  it("EXIT when risk > 60", () => {
    expect(deriveSubnetAction(70, 65, 60)).toBe("EXIT");
  });
  it("ENTER when opp > 60 + risk < 35 + conf > 50", () => {
    expect(deriveSubnetAction(70, 30, 60)).toBe("ENTER");
  });
  it("WATCH for moderate conditions", () => {
    expect(deriveSubnetAction(50, 40, 60)).toBe("WATCH");
  });
  it("EXIT for moderate-high risk", () => {
    expect(deriveSubnetAction(30, 50, 60)).toBe("EXIT");
  });
});
