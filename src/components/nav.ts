import { clearSession, getConnectedAddress } from "../lib/wallet.ts";
import { resetAnalytics } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";
import { truncateAddress } from "../lib/dom.ts";

declare const __APP_VERSION__: string;
const appVersion: string = __APP_VERSION__;

export function renderNav(): HTMLElement {
  const address = getConnectedAddress();
  const nav = document.createElement("nav");
  nav.innerHTML = `
    <div class="nav-inner">
      <span class="nav-brand">Council Console <span class="version-badge">v${appVersion}</span></span>
      <div class="nav-links">
        <a href="#/councils">Councils</a>
        <a href="#/deploy">Deploy</a>
        <a href="#/providers">Providers</a>
        ${address ? `<span class="nav-address">${truncateAddress(address)}</span>` : ""}
        <button id="logout-btn" class="btn-link">Logout</button>
      </div>
    </div>
  `;

  nav.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearSession();
    resetAnalytics();
    navigate("/login");
  });

  return nav;
}
