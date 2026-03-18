import { page } from "../components/page.ts";
import { loadCouncils } from "../lib/store.ts";
import { escapeHtml, truncateAddress } from "../lib/dom.ts";
import { navigate } from "../lib/router.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  const councils = loadCouncils();

  if (councils.length === 0) {
    el.innerHTML = `
      <h2>Managed Councils</h2>
      <div class="empty-state">
        <p>No councils found. Deploy your first Channel Auth + Privacy Channel contract pair.</p>
        <button id="deploy-btn" class="btn-primary">Deploy New Council</button>
      </div>
    `;
    el.querySelector("#deploy-btn")?.addEventListener("click", () => navigate("/deploy"));
    return el;
  }

  const rows = councils.map((council) => `
    <tr>
      <td>${escapeHtml(council.label || "Unnamed")}</td>
      <td class="mono">${truncateAddress(council.channelAuthId)}</td>
      <td class="mono">${council.privacyChannelId ? truncateAddress(council.privacyChannelId) : "<span class='badge badge-pending'>pending</span>"}</td>
      <td>${escapeHtml(council.assetCode)}</td>
      <td>${council.providers.length}</td>
      <td>
        <a href="#/providers?council=${encodeURIComponent(council.channelAuthId)}" class="btn-link">Manage</a>
      </td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Managed Councils</h2>
      <button id="deploy-btn" class="btn-primary">Deploy New</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>Label</th>
          <th>Channel Auth</th>
          <th>Privacy Channel</th>
          <th>Asset</th>
          <th>Providers</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  el.querySelector("#deploy-btn")?.addEventListener("click", () => navigate("/deploy"));
  return el;
}

export const councilsView = page(renderContent);
