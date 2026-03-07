import { describe, it, expect } from "vitest";
import {
  macroColor, macroBg, macroBorder, macroIcon,
  actionColor, actionBg, actionBorder, actionIcon,
} from "@/lib/strategy-colors";

describe("macro color helpers", () => {
  it("macroColor returns correct colors", () => {
    expect(macroColor("INCREASE")).toContain("76,175,80");
    expect(macroColor("NEUTRAL")).toContain("255,193,7");
    expect(macroColor("REDUCE")).toContain("229,57,53");
  });
  it("macroBg returns lower opacity", () => {
    expect(macroBg("INCREASE")).toContain("0.08");
    expect(macroBg("NEUTRAL")).toContain("0.06");
    expect(macroBg("REDUCE")).toContain("0.08");
  });
  it("macroBorder returns border opacity", () => {
    expect(macroBorder("INCREASE")).toContain("0.25");
    expect(macroBorder("NEUTRAL")).toContain("0.2");
    expect(macroBorder("REDUCE")).toContain("0.25");
  });
  it("macroIcon returns emoji", () => {
    expect(macroIcon("INCREASE")).toBe("📈");
    expect(macroIcon("NEUTRAL")).toBe("⚖️");
    expect(macroIcon("REDUCE")).toBe("📉");
  });
});

describe("action color helpers", () => {
  const actions = ["ENTER", "WATCH", "EXIT", "STAKE", "NEUTRAL", "HOLD"] as const;

  it("actionColor returns rgba for all actions", () => {
    for (const a of actions) expect(actionColor(a)).toContain("rgba");
  });
  it("actionBg returns rgba for all actions", () => {
    for (const a of actions) expect(actionBg(a)).toContain("rgba");
  });
  it("actionBorder returns rgba for all actions", () => {
    for (const a of actions) expect(actionBorder(a)).toContain("rgba");
  });
  it("actionIcon returns emoji for all actions", () => {
    expect(actionIcon("ENTER")).toBe("🟢");
    expect(actionIcon("WATCH")).toBe("👁");
    expect(actionIcon("EXIT")).toBe("🔴");
    expect(actionIcon("STAKE")).toBe("⬆");
    expect(actionIcon("NEUTRAL")).toBe("⏸");
    expect(actionIcon("HOLD")).toBe("🟡");
  });

  it("ENTER is green", () => expect(actionColor("ENTER")).toContain("76,175,80"));
  it("EXIT is red", () => expect(actionColor("EXIT")).toContain("229,57,53"));
  it("WATCH is amber", () => expect(actionColor("WATCH")).toContain("255,193,7"));
});
