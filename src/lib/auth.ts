/**
 * Shared logout handler. Used by the nav's logout icon
 * (renderNav onLogout) from page.ts and onboarding/layout.ts.
 */
import { clearSession } from "./wallet.ts";
import { resetAnalytics } from "./analytics.ts";
import { clearPlatformAuth } from "./platform.ts";
import { navigate } from "./router.ts";

export function logout(): void {
  clearSession();
  clearPlatformAuth();
  resetAnalytics();
  // Clear deployment progress and drafts so the next login starts clean.
  localStorage.removeItem("council_create_progress");
  sessionStorage.clear();
  navigate("/login");
}
