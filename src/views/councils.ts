import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { deleteCouncil } from "../lib/platform.ts";
import { navigate } from "../lib/router.ts";
import { fetchCouncilState, type CouncilState } from "../lib/onboarding.ts";

async function renderContent(): Promise<HTMLElement> {
  const el = document.createElement("div");

  // Fetch from platform DB — the source of truth
  const state = await fetchCouncilState();

  if (!state.exists) {
    el.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:3rem 2rem">
        <h2 style="margin-bottom:1rem">No councils yet</h2>
        <p style="color:var(--text-muted);max-width:420px;margin:0 auto 1.5rem">
          Create a council to start managing privacy channels and onboarding providers.
        </p>
        <div style="display:flex;gap:1rem;justify-content:center">
          <button id="create-btn" class="btn-primary" style="padding:0.75rem 2rem">Create</button>
          <button id="import-btn" class="btn-primary" style="padding:0.75rem 2rem;background:var(--border)">Import</button>
        </div>
      </div>
    `;
    el.querySelector("#create-btn")?.addEventListener("click", () => navigate("/create-council/metadata"));
    el.querySelector("#import-btn")?.addEventListener("click", () => navigate("/import-council"));
    return el;
  }

  // Build table row from platform data
  const inviteLink = `${window.location.origin}${window.location.pathname}#/join`;
  const assets = state.channels.map((ch) => ch.assetCode);
  const badges = assets.map((a) => `<span class="asset-badge" style="padding:0.2rem 0.5rem;font-size:0.75rem">${escapeHtml(a)}</span>`).join("");
  const flags = state.jurisdictions.map((j) => {
    const flag = j.countryCode.toUpperCase().replace(/./g, (c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
    return `<span title="${escapeHtml(j.countryCode)}" style="font-size:1.1rem">${flag}</span>`;
  }).join(" ");

  el.innerHTML = `
    <div class="page-header"><h2>Councils</h2><div class="header-icons"><button id="import-btn" class="icon-btn" title="Import existing council"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button><button id="new-council-btn" class="icon-btn" title="Create new council"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></button></div></div>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th class="text-left">Jurisdictions</th>
          <th>Assets</th>
          <th class="text-right"></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><a href="#/council?id=${encodeURIComponent(state.channelAuthId || "")}" style="color:var(--text);text-decoration:none">${escapeHtml(state.name || "Unnamed")}</a></td>
          <td class="text-left">${flags || '<span style="color:var(--text-muted)">--</span>'}</td>
          <td>${badges || '<span style="color:var(--text-muted)">--</span>'}</td>
          <td class="text-right" style="white-space:nowrap"><span class="icon-btn" title="${state.providers.length} provider${state.providers.length !== 1 ? "s" : ""}" style="cursor:default"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><button class="icon-btn copy-invite" data-link="${escapeHtml(inviteLink)}" title="Copy invite link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button><button class="icon-btn delete-council" title="Delete council"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button></td>
        </tr>
      </tbody>
    </table>
  `;

  el.querySelector("#new-council-btn")?.addEventListener("click", () => navigate("/create-council/metadata"));
  el.querySelector("#import-btn")?.addEventListener("click", () => navigate("/import-council"));

  el.querySelector(".delete-council")?.addEventListener("click", async () => {
    if (!confirm("Delete this council? This removes all data from the platform. On-chain contracts are not affected.")) return;
    try {
      await deleteCouncil();
      navigate("/", { force: true });
    } catch (err) {
      console.error("Failed to delete council:", err);
    }
  });

  el.querySelectorAll(".copy-invite").forEach((btn) => {
    btn.addEventListener("click", () => {
      const link = (btn as HTMLElement).dataset.link;
      if (!link) return;
      navigator.clipboard.writeText(link).then(() => {
        const original = btn.querySelector("svg")!.outerHTML;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
        setTimeout(() => { btn.innerHTML = original; }, 1500);
      });
    });
  });

  return el;
}

export const councilsView = page(renderContent);
