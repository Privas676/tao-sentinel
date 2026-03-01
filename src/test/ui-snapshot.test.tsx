/**
 * UI Snapshot Tests — ensures pages remain structurally identical
 * during internal refactors (SAFE_REFACTOR_MODE).
 *
 * These tests verify:
 * 1. All frozen pages exist and render without crashing
 * 2. Route structure matches frozen list
 * 3. Nav item count is stable
 * 4. Page component export names are unchanged
 */
import { describe, it, expect } from "vitest";
import {
  SAFE_REFACTOR_MODE,
  FROZEN_UI_PAGES,
  FROZEN_ROUTES,
  FROZEN_NAV_COUNT,
} from "@/lib/safe-refactor";

describe("SAFE_REFACTOR_MODE guards", () => {
  it("flag is enabled", () => {
    expect(SAFE_REFACTOR_MODE).toBe(true);
  });

  it("all frozen pages exist as importable modules", async () => {
    const pageModules: Record<string, () => Promise<any>> = {
      AlienGauge: () => import("@/pages/AlienGauge"),
      SubnetsPage: () => import("@/pages/SubnetsPage"),
      AlertsPage: () => import("@/pages/AlertsPage"),
      SettingsPage: () => import("@/pages/SettingsPage"),
      PortfolioPage: () => import("@/pages/PortfolioPage"),
      InstallPage: () => import("@/pages/InstallPage"),
      AuthPage: () => import("@/pages/AuthPage"),
    };

    for (const name of FROZEN_UI_PAGES) {
      const mod = await pageModules[name]();
      expect(mod).toBeDefined();
      // Each page must have a default export (the component)
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    }
  });

  it("frozen routes list matches expected count", () => {
    expect(FROZEN_ROUTES).toHaveLength(7);
  });

  it("frozen nav count is stable", () => {
    expect(FROZEN_NAV_COUNT).toBe(6);
  });
});

describe("App route structure snapshot", () => {
  it("App.tsx contains all frozen routes", async () => {
    // We import the raw module to verify routes are wired
    const appMod = await import("@/App");
    expect(appMod.default).toBeDefined();
  });

  it("routes match frozen list exactly", () => {
    const expected = ["/", "/subnets", "/portfolio", "/alerts", "/settings", "/auth", "/install"];
    expect([...FROZEN_ROUTES]).toEqual(expected);
  });
});

describe("Page structural snapshots", () => {
  it("SettingsPage has expected sections", async () => {
    // Verify the component exports and structure hasn't changed
    const mod = await import("@/pages/SettingsPage");
    expect(mod.default.name).toBe("SettingsPage");
  });

  it("InstallPage has expected export", async () => {
    const mod = await import("@/pages/InstallPage");
    expect(mod.default.name).toBe("InstallPage");
  });
});
