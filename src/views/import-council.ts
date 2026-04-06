import { page } from "../components/page.ts";
import { navigate } from "../lib/router.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { escapeHtml } from "../lib/dom.ts";
import {
  isPlatformConfigured,
  isAuthenticated as isPlatformAuthed,
  listCouncils,
  pushMetadata,
  addJurisdiction,
  registerChannel,
  listKnownAssets,
} from "../lib/platform.ts";
import { COUNTRY_CODES } from "../lib/jurisdictions.ts";
import { capture } from "../lib/analytics.ts";

/**
 * A discovered council entry from scanning deterministic indices.
 */
interface CouncilEntry {
  index: number;
  address: string;
  /** "active" = in DB, "onchain" = on-chain but not in DB */
  status: "active" | "onchain";
  name: string | null;
}

/** Stop scanning after this many consecutive misses (not on-chain, not in DB). */
const MAX_CONSECUTIVE_MISSES = 3;

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  el.style.maxWidth = "700px";
  el.style.margin = "0 auto";

  el.innerHTML = `
    <h2>Recover</h2>
    <p id="scan-status" style="color:var(--text-muted);margin-bottom:1.5rem">
      Scanning your wallet for existing councils...
    </p>
    <div id="scan-results"></div>
  `;

  const statusEl = el.querySelector("#scan-status") as HTMLParagraphElement;
  const resultsEl = el.querySelector("#scan-results") as HTMLDivElement;

  const adminAddress = getConnectedAddress();
  if (!adminAddress) {
    statusEl.textContent = "Connect your wallet first.";
    return el;
  }

  scanCouncils(adminAddress, statusEl, resultsEl);
  return el;
}

async function scanCouncils(
  adminAddress: string,
  statusEl: HTMLParagraphElement,
  resultsEl: HTMLDivElement,
) {
  const { computeCouncilSalt, deriveContractAddress, sdk: getSdk, getRpcServer } = await import("../lib/stellar.ts");
  const { getNetworkPassphrase } = await import("../lib/config.ts");
  const stellar = await getSdk();
  const server = await getRpcServer();

  // Fetch DB state
  const activeCouncilIds = new Map<string, string>(); // address → name

  if (isPlatformConfigured() && isPlatformAuthed()) {
    try {
      const active = await listCouncils();
      for (const c of active) activeCouncilIds.set(c.councilId, c.name);
    } catch { /* platform unavailable */ }
  }

  const entries: CouncilEntry[] = [];
  let consecutiveMisses = 0;
  let index = 0;

  while (consecutiveMisses < MAX_CONSECUTIVE_MISSES) {
    statusEl.textContent = `Scanning index ${index}...`;

    const salt = await computeCouncilSalt(adminAddress, index);
    const address = await deriveContractAddress(adminAddress, salt);

    // Skip councils already in the DB
    if (activeCouncilIds.has(address)) {
      consecutiveMisses = 0;
      index++;
      continue;
    }

    // Check on-chain (slow — simulate admin() call)
    try {
      const contract = new stellar.Contract(address);
      const account = await server.getAccount(adminAddress);
      const tx = new stellar.TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: getNetworkPassphrase(),
      })
        .addOperation(contract.call("admin"))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (!("error" in sim && sim.error)) {
        entries.push({ index, address, status: "onchain", name: null });
        consecutiveMisses = 0;
        index++;
        continue;
      }
    } catch { /* not found */ }

    // Not found anywhere
    consecutiveMisses++;
    index++;
  }

  // Render results
  if (entries.length === 0) {
    statusEl.textContent = "No councils found for this wallet.";
    resultsEl.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:2rem">
        <p style="color:var(--text-muted)">No existing councils were found. You can create a new one from the home page.</p>
        <button id="back-btn" class="btn-primary" style="margin-top:1rem">Back</button>
      </div>
    `;
    resultsEl.querySelector("#back-btn")?.addEventListener("click", () => navigate("/"));
    return;
  }

  statusEl.textContent = "";

  const rows = entries.map((e, i) => {
    const short = `${e.address.slice(0, 6)}...${e.address.slice(-4)}`;

    let actionCell: string;
    switch (e.status) {
      case "active":
        actionCell = `<a href="#/council?id=${encodeURIComponent(e.address)}" class="btn-link" style="font-size:0.85rem">View</a>`;
        break;
      case "onchain":
        actionCell = `<button class="icon-btn import-btn" data-addr="${escapeHtml(e.address)}" data-index="${e.index}" title="Recover"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 13v8l-4-4"/><path d="m12 21 4-4"/><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/></svg></button>`;
        break;
    }

    return `
      <tr>
        <td>${i + 1}</td>
        <td style="font-family:var(--font-mono);font-size:0.75rem;word-break:break-all">${escapeHtml(e.address)}</td>
        <td style="text-align:right">${actionCell}</td>
      </tr>
    `;
  }).join("");

  resultsEl.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Address</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Wire import buttons
  resultsEl.querySelectorAll(".import-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const address = (btn as HTMLElement).dataset.addr!;
      showImportForm(address);
    });
  });
}

/**
 * Show the import form for an on-chain council not in the DB.
 * Collects name, description, email, jurisdictions, then registers with platform + discovers channels.
 */
function showImportForm(contractId: string) {
  document.querySelector("#recover-modal")?.remove();

  const selectedJurisdictions = new Set<string>();

  const overlay = document.createElement("div");
  overlay.id = "recover-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 style="font-family:var(--font-mono);font-size:0.8rem;word-break:break-all;margin:0">${contractId}</h3>
      </div>

      <div class="form-group">
        <label>Council Name *</label>
        <input type="text" id="import-name" placeholder="e.g. Moonlight Beta" />
      </div>

      <div class="form-group">
        <label>Description</label>
        <textarea id="import-description" rows="3" maxlength="500"
          placeholder="What does this council do?"
          style="width:100%;padding:0.6rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.875rem;font-family:var(--font-sans);resize:vertical"></textarea>
      </div>

      <div class="form-group">
        <label>Contact Email</label>
        <input type="email" id="import-email" placeholder="admin@example.com" />
      </div>

      <div class="form-group">
        <label>Jurisdictions</label>
        <div id="import-tags" class="jurisdiction-tags"></div>
        <div class="jurisdiction-picker">
          <input type="text" id="import-filter" placeholder="Search countries..."
            style="border:none;border-bottom:1px solid var(--border);border-radius:0;position:sticky;top:0;background:var(--bg);z-index:1" />
          <div id="import-list" class="jurisdiction-list"></div>
        </div>
      </div>

      <p id="import-error" class="error-text" hidden></p>
      <button id="import-submit-btn" class="btn-primary btn-wide" style="margin-top:0.75rem">Recover</button>
    </div>
  `;

  document.body.appendChild(overlay);

  function close() { overlay.remove(); document.removeEventListener("keydown", onEsc); }
  function onEsc(e: KeyboardEvent) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onEsc);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const container = overlay.querySelector(".modal") as HTMLDivElement;

  // Jurisdiction picker
  const tagsEl = container.querySelector("#import-tags") as HTMLDivElement;
  const filterEl = container.querySelector("#import-filter") as HTMLInputElement;
  const listEl = container.querySelector("#import-list") as HTMLDivElement;

  function renderTags() {
    tagsEl.innerHTML = "";
    for (const code of selectedJurisdictions) {
      const entry = COUNTRY_CODES.find((c) => c.code === code);
      if (!entry) continue;
      const tag = document.createElement("span");
      tag.className = "jurisdiction-tag";
      tag.textContent = `${entry.code} `;
      const x = document.createElement("button");
      x.textContent = "\u00d7";
      x.style.cssText = "background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0 0 0 0.25rem;font-size:1rem";
      x.addEventListener("click", () => { selectedJurisdictions.delete(code); renderTags(); renderList(filterEl.value); });
      tag.appendChild(x);
      tagsEl.appendChild(tag);
    }
  }

  function renderList(filter: string) {
    listEl.innerHTML = "";
    const q = filter.toLowerCase();
    if (q.length < 2) {
      const hint = document.createElement("p");
      hint.style.cssText = "color:var(--text-muted);font-size:0.8rem;padding:0.5rem 0.75rem";
      hint.textContent = "Type at least 2 characters to search...";
      listEl.appendChild(hint);
      return;
    }
    for (const country of COUNTRY_CODES) {
      if (!country.label.toLowerCase().includes(q) && !country.code.toLowerCase().includes(q)) continue;
      const selected = selectedJurisdictions.has(country.code);
      const option = document.createElement("div");
      option.className = "jurisdiction-option" + (selected ? " selected" : "");
      const flag = country.code.toUpperCase().replace(/./g, (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
      option.textContent = `${flag} ${country.label}`;
      option.addEventListener("click", () => {
        if (selected) selectedJurisdictions.delete(country.code);
        else selectedJurisdictions.add(country.code);
        renderTags();
        if (!selected) { filterEl.value = ""; renderList(""); }
        else renderList(filterEl.value);
      });
      listEl.appendChild(option);
    }
  }

  renderTags();
  renderList("");
  filterEl.addEventListener("input", () => renderList(filterEl.value));

  // Submit
  const submitBtn = container.querySelector("#import-submit-btn") as HTMLButtonElement;
  const errorEl = container.querySelector("#import-error") as HTMLParagraphElement;

  submitBtn.addEventListener("click", async () => {
    const name = (container.querySelector("#import-name") as HTMLInputElement).value.trim();
    if (!name) { errorEl.textContent = "Council name is required"; errorEl.hidden = false; return; }

    const description = (container.querySelector("#import-description") as HTMLTextAreaElement).value.trim();
    const contactEmail = (container.querySelector("#import-email") as HTMLInputElement).value.trim();
    const jurisdictions = Array.from(selectedJurisdictions);
    const adminAddress = getConnectedAddress()!;

    submitBtn.disabled = true;
    submitBtn.textContent = "Discovering channels...";
    errorEl.hidden = true;

    try {
      const { computeDeploySalt, deriveContractAddress, getAssetContractId, sdk: getSdk, getRpcServer } = await import("../lib/stellar.ts");
      const { getNetworkPassphrase } = await import("../lib/config.ts");
      const stellar = await getSdk();
      const server = await getRpcServer();

      // Discover channels by checking known assets
      const knownAssets = await listKnownAssets();
      const assetsToCheck = [{ assetCode: "XLM", issuerAddress: "" }, ...knownAssets];
      const seen = new Set<string>();
      const uniqueAssets = assetsToCheck.filter((a) => {
        const key = `${a.assetCode}:${a.issuerAddress}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const discoveredChannels: Array<{ contractId: string; assetCode: string; issuerAddress: string }> = [];

      for (const asset of uniqueAssets) {
        try {
          const salt = await computeDeploySalt(contractId, asset.assetCode, asset.issuerAddress);
          const derivedAddress = await deriveContractAddress(adminAddress, salt);
          const contract = new stellar.Contract(derivedAddress);
          const account = await server.getAccount(adminAddress);
          const tx = new stellar.TransactionBuilder(account, { fee: "100", networkPassphrase: getNetworkPassphrase() })
            .addOperation(contract.call("auth"))
            .setTimeout(30)
            .build();
          const sim = await server.simulateTransaction(tx);
          if (!("error" in sim && sim.error)) {
            discoveredChannels.push({ contractId: derivedAddress, assetCode: asset.assetCode, issuerAddress: asset.issuerAddress });
          }
        } catch { /* not found */ }
      }

      submitBtn.textContent = `Found ${discoveredChannels.length} channel${discoveredChannels.length !== 1 ? "s" : ""}. Registering...`;

      // Push to platform
      if (isPlatformConfigured()) {
        await pushMetadata({ councilId: contractId, name, description: description || undefined, contactEmail: contactEmail || undefined });

        for (const code of jurisdictions) {
          const entry = COUNTRY_CODES.find((c) => c.code === code);
          await addJurisdiction(contractId, code, entry?.label);
        }

        for (const ch of discoveredChannels) {
          const sacId = await getAssetContractId(ch.assetCode, ch.issuerAddress || undefined);
          await registerChannel(contractId, {
            channelContractId: ch.contractId,
            assetCode: ch.assetCode,
            assetContractId: sacId,
            issuerAddress: ch.issuerAddress,
            label: `${ch.assetCode} Privacy Channel`,
          });
        }
      }

      capture("council_imported", { channelAuthId: contractId, channels: discoveredChannels.length });
      close();
      navigate("/");
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Recover";
    }
  });
}

export const importCouncilView = page(renderContent);
