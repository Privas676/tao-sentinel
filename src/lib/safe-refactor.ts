/* ═══════════════════════════════════════ */
/*   SAFE REFACTOR MODE — UI GUARD         */
/* ═══════════════════════════════════════ */

export const SAFE_REFACTOR_MODE = true;

export const FROZEN_UI_PAGES = [
  "CompassPage",
  "SubnetsPage",
  "SubnetDetailPage",
  "PortfolioPage",
  "AlertsPage",
  "SettingsPage",
  "LabPage",
  "AuthPage",
  "InstallPage",
] as const;

export const FROZEN_ROUTES = [
  "/compass",
  "/subnets",
  "/portfolio",
  "/alerts",
  "/settings",
  "/lab",
  "/auth",
  "/install",
] as const;

export const FROZEN_NAV_COUNT = 6;
