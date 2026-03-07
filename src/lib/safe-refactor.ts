/* ═══════════════════════════════════════ */
/*   SAFE REFACTOR MODE — UI GUARD         */
/* ═══════════════════════════════════════ */

export const SAFE_REFACTOR_MODE = true;

export const FROZEN_UI_PAGES = [
  "AlienGauge",
  "SubnetsPage",
  "AlertsPage",
  "SettingsPage",
  "PortfolioPage",
  "InstallPage",
  "AuthPage",
] as const;

export const FROZEN_ROUTES = [
  "/",
  "/subnets",
  "/portfolio",
  "/alerts",
  "/settings",
  "/auth",
  "/install",
] as const;

export const FROZEN_NAV_COUNT = 8;
