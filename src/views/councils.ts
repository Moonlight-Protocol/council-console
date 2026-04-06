import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { deleteCouncil, listCouncils } from "../lib/platform.ts";
import { navigate } from "../lib/router.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { PLATFORM_URL } from "../lib/config.ts";
import { fetchCouncilState } from "../lib/onboarding.ts";
import { isPlatformConfigured, isAuthenticated as isPlatformAuthed } from "../lib/platform.ts";

async function renderContent(): Promise<HTMLElement> {
  const el = document.createElement("div");

  if (!isPlatformConfigured() || !isPlatformAuthed()) {
    el.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:3rem 2rem">
        <h2 style="margin-bottom:1rem">No councils yet</h2>
        <p style="color:var(--text-muted);max-width:420px;margin:0 auto 1.5rem">
          Create a council to start managing privacy channels and onboarding providers.
        </p>
        <div style="display:flex;gap:1rem;justify-content:center">
          <button id="create-btn" class="btn-primary" style="padding:0.75rem 2rem">Create</button>
          <button id="import-btn" class="btn-primary" style="padding:0.75rem 2rem;background:var(--border)">Recover</button>
        </div>
      </div>
    `;
    el.querySelector("#create-btn")?.addEventListener("click", () => { (() => { for (const key of Object.keys(sessionStorage)) { if (key.startsWith("onboarding_")) sessionStorage.removeItem(key); } })(); navigate("/create-council/metadata"); });
    el.querySelector("#import-btn")?.addEventListener("click", () => navigate("/recover-council"));
    return el;
  }

  // Fetch all councils
  let councils: Array<{ councilId: string; name: string }> = [];
  try {
    councils = await listCouncils();
  } catch { /* platform unavailable */ }

  if (councils.length === 0) {
    el.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:3rem 2rem">
        <h2 style="margin-bottom:1rem">No councils yet</h2>
        <p style="color:var(--text-muted);max-width:420px;margin:0 auto 1.5rem">
          Create a council to start managing privacy channels and onboarding providers.
        </p>
        <div style="display:flex;gap:1rem;justify-content:center">
          <button id="create-btn" class="btn-primary" style="padding:0.75rem 2rem">Create</button>
          <button id="import-btn" class="btn-primary" style="padding:0.75rem 2rem;background:var(--border)">Recover</button>
        </div>
      </div>
    `;
    el.querySelector("#create-btn")?.addEventListener("click", () => { (() => { for (const key of Object.keys(sessionStorage)) { if (key.startsWith("onboarding_")) sessionStorage.removeItem(key); } })(); navigate("/create-council/metadata"); });
    el.querySelector("#import-btn")?.addEventListener("click", () => navigate("/recover-council"));
    return el;
  }

  // Fetch state for each council to get jurisdictions, assets, providers
  const states = await Promise.all(
    councils.map(async (c) => {
      const state = await fetchCouncilState(c.councilId);
      return { ...c, state };
    }),
  );

  const baseUrl = PLATFORM_URL || `${window.location.origin}${window.location.pathname}#/join`;

  const rows = states.map(({ councilId, state }) => {
    const inviteLink = `${baseUrl}?council=${councilId}`;
    const assets = state.channels.map((ch) => ch.assetCode);
    const badges = assets.map((a) => `<span class="asset-badge" style="padding:0.2rem 0.5rem;font-size:0.75rem">${escapeHtml(a)}</span>`).join("");
    const flags = state.jurisdictions.map((j) => {
      const flag = j.countryCode.toUpperCase().replace(/./g, (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
      return `<span title="${escapeHtml(j.countryCode)}" style="font-size:1.1rem">${flag}</span>`;
    }).join(" ");

    return `
      <tr>
        <td><a href="#/council?id=${encodeURIComponent(councilId)}" style="color:var(--text);text-decoration:none">${escapeHtml(state.name || "Unnamed")}</a></td>
        <td class="text-left">${flags || '<span style="color:var(--text-muted)">--</span>'}</td>
        <td>${badges || '<span style="color:var(--text-muted)">--</span>'}</td>
        <td class="text-right" style="white-space:nowrap">
          <span class="icon-btn" title="${state.providers.length} provider${state.providers.length !== 1 ? "s" : ""}" style="cursor:default"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/></svg></span>
          <button class="icon-btn copy-invite" data-link="${escapeHtml(inviteLink)}" title="Copy invite link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
          <button class="icon-btn delete-council" data-id="${escapeHtml(councilId)}" title="Delete council"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
        </td>
      </tr>
    `;
  }).join("");

  el.innerHTML = `
    <div class="page-header"><h2>Councils</h2><div class="header-icons"><button id="import-btn" class="icon-btn" title="Recover council"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.1 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.589 3.588A2.4 2.4 0 0 1 20 8v3.25"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m21 22-2.88-2.88"/><circle cx="16" cy="17" r="3"/></svg></button><button id="new-council-btn" class="icon-btn" title="Create new council"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button></div></div>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th class="text-left">Jurisdictions</th>
          <th>Assets</th>
          <th class="text-right"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  el.querySelector("#new-council-btn")?.addEventListener("click", () => { (() => { for (const key of Object.keys(sessionStorage)) { if (key.startsWith("onboarding_")) sessionStorage.removeItem(key); } })(); navigate("/create-council/metadata"); });
  el.querySelector("#import-btn")?.addEventListener("click", () => navigate("/recover-council"));

  el.querySelectorAll(".delete-council").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = (btn as HTMLElement).dataset.id!;
      const councilState = states.find((s) => s.councilId === id);
      const providerCount = councilState?.state.providers.length ?? 0;

      const msg = providerCount > 0
        ? `Delete this council? This will remove ${providerCount} provider${providerCount !== 1 ? "s" : ""} on-chain and delete all data from the platform.`
        : "Delete this council? This removes all data from the platform.";
      if (!confirm(msg)) return;

      try {
        // Remove all providers on-chain in a single transaction
        if (providerCount > 0 && councilState) {
          const { sdk: getSdk, getRpcServer } = await import("../lib/stellar.ts");
          const { signTransaction } = await import("../lib/wallet.ts");
          const { getNetworkPassphrase } = await import("../lib/config.ts");
          const stellar = await getSdk();
          const server = await getRpcServer();
          const adminAddress = getConnectedAddress()!;

          const contract = new stellar.Contract(id);
          const account = await server.getAccount(adminAddress);
          const builder = new stellar.TransactionBuilder(account, {
            fee: "10000000",
            networkPassphrase: getNetworkPassphrase(),
          });

          for (const p of councilState.state.providers) {
            builder.addOperation(
              contract.call("remove_provider", stellar.nativeToScVal(
                stellar.Address.fromString(p.publicKey), { type: "address" },
              )),
            );
          }

          const tx = builder.setTimeout(300).build();
          const sim = await server.simulateTransaction(tx);
          if ("error" in sim && sim.error) throw new Error(`Simulation failed: ${sim.error}`);
          const { assembleTransaction } = stellar.rpc;
          const prepared = assembleTransaction(tx, sim).build();
          const signedXdr = await signTransaction(prepared.toXDR());

          const signed = stellar.TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase());
          const result = await server.sendTransaction(signed);

          // Wait for confirmation
          for (let i = 0; i < 30; i++) {
            const status = await server.getTransaction(result.hash);
            if (status.status === "SUCCESS") break;
            if (status.status === "FAILED") throw new Error("remove_provider transaction failed");
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        await deleteCouncil(id);
        window.location.reload();
      } catch (err) {
        console.error("Failed to delete council:", err);
      }
    });
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
