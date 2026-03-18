import { page } from "../components/page.ts";
import { loadCouncils, removeCouncil, updateCouncil } from "../lib/store.ts";
import { escapeHtml, truncateAddress } from "../lib/dom.ts";
import { navigate } from "../lib/router.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  const councils = loadCouncils();

  if (councils.length === 0) {
    el.innerHTML = `
      <h2>Managed Councils</h2>
      <div class="empty-state">
        <p>No councils found. Deploy a new council or import an existing one.</p>
        <div style="display:flex;gap:0.5rem;justify-content:center;margin-top:0.5rem">
          <button id="deploy-btn" class="btn-primary">Deploy New</button>
          <a href="#/import" class="btn-primary" style="background:var(--border);display:inline-block">Import Existing</a>
        </div>
      </div>
    `;
    el.querySelector("#deploy-btn")?.addEventListener("click", () => navigate("/deploy"));
    return el;
  }

  const rows = councils.map((council) => `
    <tr data-council="${escapeHtml(council.channelAuthId)}">
      <td>${escapeHtml(council.label || "Unnamed")}</td>
      <td class="mono">${truncateAddress(council.channelAuthId)}</td>
      <td class="mono">${council.privacyChannelId ? truncateAddress(council.privacyChannelId) : `<button class="btn-link set-privacy-channel" data-council="${escapeHtml(council.channelAuthId)}">Set</button>`}</td>
      <td>${escapeHtml(council.assetCode)}</td>
      <td>${council.providers.length}</td>
      <td style="white-space:nowrap">
        <a href="#/providers?council=${encodeURIComponent(council.channelAuthId)}" class="btn-link">Manage</a>
        <button class="btn-link remove-council" data-council="${escapeHtml(council.channelAuthId)}" style="color:var(--inactive)">Remove</button>
      </td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Managed Councils</h2>
      <div style="display:flex;gap:0.5rem">
        <a href="#/import" class="btn-primary" style="background:var(--border);display:inline-block">Import</a>
        <button id="deploy-btn" class="btn-primary">Deploy New</button>
      </div>
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

  // Remove council
  el.querySelectorAll(".remove-council").forEach((btn) => {
    btn.addEventListener("click", () => {
      const councilId = (btn as HTMLElement).dataset.council;
      if (!councilId) return;
      if (!confirm(`Remove council ${truncateAddress(councilId)} from this console? This only removes the local record, not the on-chain contract.`)) return;
      removeCouncil(councilId);
      navigate("/councils", { force: true });
    });
  });

  // Set privacy channel ID
  el.querySelectorAll(".set-privacy-channel").forEach((btn) => {
    btn.addEventListener("click", () => {
      const councilId = (btn as HTMLElement).dataset.council;
      if (!councilId) return;
      const privacyChannelId = prompt("Enter the Privacy Channel contract ID:");
      if (!privacyChannelId?.trim()) return;
      updateCouncil(councilId, { privacyChannelId: privacyChannelId.trim() });
      navigate("/councils", { force: true });
    });
  });

  return el;
}

export const councilsView = page(renderContent);
