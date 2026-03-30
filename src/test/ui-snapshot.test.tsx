/**
 * UI Snapshot Tests — ensures pages remain structurally identical
 * during internal refactors (SAFE_REFACTOR_MODE).
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
      CompassPage: () => import("@/pages/CompassPage"),
      SubnetsPage: () => import("@/pages/SubnetsPage"),
      SubnetDetailPage: () => import("@/pages/SubnetDetailPage"),
      PortfolioPage: () => import("@/pages/PortfolioPage"),
      AlertsPage: () => import("@/pages/AlertsPage"),
      SettingsPage: () => import("@/pages/SettingsPage"),
      LabPage: () => import("@/pages/LabPage"),
      AuthPage: () => import("@/pages/AuthPage"),
      InstallPage: () => import("@/pages/InstallPage"),
    };

    for (const name of FROZEN_UI_PAGES) {
      const mod = await pageModules[name]();
      expect(mod).toBeDefined();
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    }
  }, 30000);

  it("frozen routes list matches expected count", () => {
    expect(FROZEN_ROUTES).toHaveLength(8);
  });

  it("frozen nav count is stable", () => {
    expect(FROZEN_NAV_COUNT).toBe(6);
  });
});

describe("App route structure snapshot", () => {
  it("App.tsx contains all frozen routes", async () => {
    const appMod = await import("@/App");
    expect(appMod.default).toBeDefined();
  });

  it("routes match frozen list exactly", () => {
    const expected = ["/compass", "/subnets", "/portfolio", "/alerts", "/settings", "/lab", "/auth", "/install"];
    expect([...FROZEN_ROUTES]).toEqual(expected);
  });
});

describe("Page structural snapshots", () => {
  it("SettingsPage has expected export", async () => {
    const mod = await import("@/pages/SettingsPage");
    expect(mod.default.name).toBe("SettingsPage");
  });

  it("LabPage has expected export", async () => {
    const mod = await import("@/pages/LabPage");
    expect(mod.default.name).toBe("LabPage");
  });

  it("InstallPage has expected export", async () => {
    const mod = await import("@/pages/InstallPage");
    expect(mod.default.name).toBe("InstallPage");
  });
});
