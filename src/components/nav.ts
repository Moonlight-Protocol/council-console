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
        <button id="logout-btn" class="btn-link">Logout</button>
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
