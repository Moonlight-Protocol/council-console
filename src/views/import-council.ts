import { page } from "../components/page.ts";
import { navigate } from "../lib/router.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { escapeHtml } from "../lib/dom.ts";
import { COUNTRY_CODES } from "../lib/jurisdictions.ts";
import {
  isPlatformConfigured,
  pushMetadata,
  addJurisdiction,
} from "../lib/platform.ts";
import { capture } from "../lib/analytics.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  el.style.maxWidth = "600px";
  el.style.margin = "0 auto";

  el.innerHTML = `
    <h2>Import Council</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Enter your Channel Auth contract address to import an existing council.
    </p>

    <div class="form-group">
      <label>Channel Auth Contract ID</label>
      <input type="text" id="contract-id" placeholder="C..." style="font-family:var(--font-mono);font-size:0.85rem" />
    </div>
    <p id="verify-status" class="hint-text" hidden></p>
    <p id="verify-error" class="error-text" hidden></p>
    <button id="verify-btn" class="btn-primary">Verify</button>

    <div id="details-section" hidden style="margin-top:1.5rem">

      <div class="form-group">
        <label>Council Name *</label>
        <input type="text" id="council-name" placeholder="e.g. Moonlight Beta" />
      </div>

      <div class="form-group">
        <label>Description</label>
        <textarea id="council-description" rows="3" maxlength="500"
          placeholder="What does this council do?"
          style="width:100%;padding:0.6rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.875rem;font-family:var(--font-sans);resize:vertical"></textarea>
      </div>

      <div class="form-group">
        <label>Contact Email</label>
        <input type="email" id="council-email" placeholder="admin@example.com" />
      </div>

      <div class="form-group">
        <label>Jurisdictions</label>
        <div id="jurisdiction-tags" class="jurisdiction-tags"></div>
        <div class="jurisdiction-picker">
          <input type="text" id="jurisdiction-filter" placeholder="Search countries..."
            style="border:none;border-bottom:1px solid var(--border);border-radius:0;position:sticky;top:0;background:var(--bg);z-index:1" />
          <div id="jurisdiction-list" class="jurisdiction-list"></div>
        </div>
      </div>

      <p id="import-error" class="error-text" hidden></p>
      <button id="import-btn" class="btn-primary btn-wide" style="margin-top:0.75rem">Import Council</button>
    </div>
  `;

  const detailsSection = el.querySelector("#details-section") as HTMLDivElement;
  const verifyBtn = el.querySelector("#verify-btn") as HTMLButtonElement;
  const verifyError = el.querySelector("#verify-error") as HTMLParagraphElement;
  const verifyStatus = el.querySelector("#verify-status") as HTMLParagraphElement;
  const contractInput = el.querySelector("#contract-id") as HTMLInputElement;

  let verifiedContractId = "";

  // --- Verify ---
  verifyBtn.addEventListener("click", async () => {
    const contractId = contractInput.value.trim();
    if (!contractId || !contractId.startsWith("C")) {
      verifyError.textContent = "Enter a valid contract address (starts with C)";
      verifyError.hidden = false;
      return;
    }

    const adminAddress = getConnectedAddress();
    if (!adminAddress) {
      verifyError.textContent = "Connect your wallet first";
      verifyError.hidden = false;
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifying...";
    verifyError.hidden = false;
    verifyError.textContent = "";

    try {
      const { sdk: getSdk, getRpcServer } = await import("../lib/stellar.ts");
      const stellar = await getSdk();
      const server = await getRpcServer();

      // Call admin() on the contract via simulation
      const contract = new stellar.Contract(contractId);
      const account = await server.getAccount(adminAddress);
      const tx = new stellar.TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: (await import("../lib/config.ts")).getNetworkPassphrase(),
      })
        .addOperation(contract.call("admin"))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);

      // The simulation result shape varies between SDK versions and bundling.
      // We defensively check for error/result fields rather than relying on
      // concrete types, because the SDK's SimulateTransactionResponse type
      // is not fully preserved through the esbuild bundle (treeShaking: false
      // keeps the code but not the type narrowing).
      if ("error" in sim && sim.error) {
        throw new Error("Contract not found or not a Channel Auth contract");
      }

      // Extract the return value from the simulation result
      const result = "result" in sim ? sim.result : undefined;
      const returnValue = result && typeof result === "object" && "retval" in result ? result.retval : undefined;
      let onChainAdmin: string;
      if (returnValue) {
        onChainAdmin = stellar.Address.fromScVal(returnValue).toString();
      } else {
        throw new Error("Could not read admin from contract");
      }

      if (onChainAdmin !== adminAddress) {
        throw new Error("You cannot import this council. Only the council admin can import it.");
      }

      // Verified — lock input and show metadata form
      verifiedContractId = contractId;
      contractInput.disabled = true;
      verifyBtn.hidden = true;
      verifyStatus.textContent = "Council found.";
      verifyStatus.hidden = false;
      verifyError.hidden = true;
      detailsSection.hidden = false;

    } catch (err) {
      verifyError.textContent = err instanceof Error ? err.message : String(err);
      verifyError.hidden = false;
      verifyBtn.disabled = false;
      verifyBtn.textContent = "Verify";
    }
  });

  // --- Jurisdiction picker ---
  const selectedJurisdictions = new Set<string>();
  const tagsEl = el.querySelector("#jurisdiction-tags") as HTMLDivElement;
  const listEl = el.querySelector("#jurisdiction-list") as HTMLDivElement;
  const filterEl = el.querySelector("#jurisdiction-filter") as HTMLInputElement;

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
      x.addEventListener("click", () => {
        selectedJurisdictions.delete(code);
        renderTags();
        renderList(filterEl.value);
      });
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
      const label = document.createElement("label");
      label.className = "jurisdiction-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = country.code;
      cb.checked = selectedJurisdictions.has(country.code);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedJurisdictions.add(country.code);
        else selectedJurisdictions.delete(country.code);
        renderTags();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(` ${country.code} \u2014 ${country.label}`));
      listEl.appendChild(label);
    }
  }

  renderTags();
  renderList("");
  filterEl.addEventListener("input", () => renderList(filterEl.value));

  // --- Import ---
  const importBtn = el.querySelector("#import-btn") as HTMLButtonElement;
  const importError = el.querySelector("#import-error") as HTMLParagraphElement;

  importBtn.addEventListener("click", async () => {
    const name = (el.querySelector("#council-name") as HTMLInputElement).value.trim();
    if (!name) {
      importError.textContent = "Council name is required";
      importError.hidden = false;
      return;
    }

    const description = (el.querySelector("#council-description") as HTMLTextAreaElement).value.trim();
    const contactEmail = (el.querySelector("#council-email") as HTMLInputElement).value.trim();
    const jurisdictions = Array.from(selectedJurisdictions);
    const adminAddress = getConnectedAddress()!;

    importBtn.disabled = true;
    importBtn.textContent = "Looking for XLM channel...";
    importError.hidden = true;

    try {
      // Discover channels by deriving addresses for all known assets
      const { computeDeploySalt, deriveContractAddress, getAssetContractId, sdk: getSdk, getRpcServer } = await import("../lib/stellar.ts");
      const { listKnownAssets, registerChannel } = await import("../lib/platform.ts");
      const stellar = await getSdk();
      const server = await getRpcServer();
      const { getNetworkPassphrase } = await import("../lib/config.ts");

      // Always check XLM (native, no issuer) + all known assets from the DB
      const knownAssets = await listKnownAssets();
      const assetsToCheck = [{ assetCode: "XLM", issuerAddress: "" }, ...knownAssets];
      // Deduplicate
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
          const salt = await computeDeploySalt(verifiedContractId, asset.assetCode, asset.issuerAddress);
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

      importBtn.textContent = `Found ${discoveredChannels.length} asset${discoveredChannels.length !== 1 ? "s" : ""}. Registering...`;

      // Push to platform DB
      if (isPlatformConfigured()) {
        try {
          await pushMetadata({ name, description: description || undefined, contactEmail: contactEmail || undefined, channelAuthId: verifiedContractId });
          for (const code of jurisdictions) {
            const entry = COUNTRY_CODES.find((c) => c.code === code);
            await addJurisdiction(code, entry?.label);
          }
          for (const ch of discoveredChannels) {
            const sacId = await getAssetContractId(ch.assetCode, ch.issuerAddress || undefined);
            await registerChannel({
              channelContractId: ch.contractId,
              assetCode: ch.assetCode,
              assetContractId: sacId,
              issuerAddress: ch.issuerAddress,
              label: `${ch.assetCode} Privacy Channel`,
            });
          }
        } catch (err) {
          importError.textContent = "Council imported but platform registration failed. Please try again.";
          importError.hidden = false;
          importBtn.disabled = false;
          importBtn.textContent = "Import Council";
          return;
        }
      }

      capture("council_imported", { channelAuthId: verifiedContractId });
      navigate("/");
    } catch (err) {
      importError.textContent = err instanceof Error ? err.message : String(err);
      importError.hidden = false;
      importBtn.disabled = false;
      importBtn.textContent = "Import Council";
    }
  });

  return el;
}

export const importCouncilView = page(renderContent);
