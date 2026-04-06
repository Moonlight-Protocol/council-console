import { clearSession, getConnectedAddress } from "../lib/wallet.ts";
import { resetAnalytics } from "../lib/analytics.ts";
import { clearPlatformAuth } from "../lib/platform.ts";
import { navigate } from "../lib/router.ts";
import { truncateAddress, escapeHtml } from "../lib/dom.ts";

declare const __APP_VERSION__: string;
const appVersion: string = __APP_VERSION__;

export function renderNav(): HTMLElement {
  const address = getConnectedAddress();
  const nav = document.createElement("nav");
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="#/" class="nav-brand" style="text-decoration:none;color:inherit">Council Console <span class="version-badge">v${appVersion}</span></a>
      <div class="nav-links">
        ${address ? `<span class="nav-address">${escapeHtml(truncateAddress(address))}</span>` : ""}
        <button id="logout-btn" class="icon-btn" title="Logout"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>
      </div>
    </div>
  `;

  nav.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearSession();
    clearPlatformAuth();
    resetAnalytics();
    // Clear deployment progress and drafts
    localStorage.removeItem("council_create_progress");
    sessionStorage.clear();
    navigate("/login");
  });

  return nav;
}
