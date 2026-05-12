import { clearSession } from "./wallet.ts";
import { clearPlatformAuth } from "./platform.ts";
import { resetAnalytics } from "./analytics.ts";
import { navigate } from "./router.ts";

/**
 * Council-console logout side effects. Centralised here so both the nav's
 * onLogout callback (set up in the page wrappers) and any direct logout
 * call sites use the same teardown sequence.
 */
export function logout(): void {
  clearSession();
  clearPlatformAuth();
  resetAnalytics();
  localStorage.removeItem("council_create_progress");
  sessionStorage.clear();
  navigate("/login");
}
