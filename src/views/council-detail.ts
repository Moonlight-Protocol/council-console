import { page } from "../components/page.ts";
import { escapeHtml, truncateAddress, friendlyError } from "../lib/dom.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { capture } from "../lib/analytics.ts";
import { startTrace, withSpan } from "../lib/tracer.ts";
import { navigate } from "../lib/router.ts";
import { PLATFORM_URL } from "../lib/config.ts";
import {
  isPlatformConfigured,
  isAuthenticated as isPlatformAuthed,
  registerChannel,
  disableChannel,
  enableChannel,
  listChannels,
  listDisabledChannels,
  pushMetadata,
} from "../lib/platform.ts";
import { renderJurisdictionMap } from "../lib/world-map.ts";
import { fetchCouncilState, type CouncilState } from "../lib/onboarding.ts";

async function renderContent(): Promise<HTMLElement> {
  const el = document.createElement("div");
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const councilId = params.get("id");

  if (!councilId) {
    navigate("/");
    return el;
  }

  // Fetch from platform DB — the source of truth
  const state = await fetchCouncilState();
  if (!state.exists) {
    el.innerHTML = `<p style="color:var(--text-muted)">Council not found on the platform. <a href="#/">Back</a></p>`;
    return el;
  }

  const council = state;
  const adminAddress = getConnectedAddress() || "";
  const channels = council.channels;
  const jurisdictions = council.jurisdictions.map((j) => j.countryCode);
  const providers = council.providers;

  // First channel is the default (non-removable)
  const defaultAssetCode = channels.length > 0 ? channels[0].assetCode : "XLM";

  const assetBadges = channels.length > 0
    ? channels.map((ch) => {
        const isDefault = ch.assetCode === defaultAssetCode && ch === channels[0];
        return `<span class="asset-badge">${escapeHtml(ch.assetCode)}${isDefault ? "" : `<button class="asset-remove" data-asset="${escapeHtml(ch.assetCode)}" data-contract="${escapeHtml(ch.channelContractId)}" title="Disable ${escapeHtml(ch.assetCode)}">&times;</button>`}</span>`;
      }).join("")
    : '<span style="color:var(--text-muted)">No assets enabled</span>';

  el.innerHTML = `
    <div class="council-header"><a href="#/" class="icon-btn" title="Back" style="color:var(--text)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></a><span class="inline-edit" data-field="name"><h2>${escapeHtml(council.name || "Unnamed Council")}</h2><svg class="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span><span class="inline-edit" data-field="contactEmail"><span style="color:var(--text-muted);font-size:0.75rem">${escapeHtml(state.contactEmail || "add email")}</span><svg class="edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span><div class="header-icons"><button class="icon-btn copy-contract" data-value="${escapeHtml(councilId)}" title="Copy Council address"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button><button class="icon-btn copy-admin" data-value="${escapeHtml(adminAddress)}" title="Copy admin address"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button><button class="icon-btn copy-invite-link" title="Copy invite link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button></div></div>

    <div id="jurisdiction-map" class="jurisdiction-map"></div>
    <div class="inline-edit" data-field="description" style="margin:0.75rem 0"><p style="color:var(--text-muted);font-size:0.85rem;margin:0">${escapeHtml(state.description || "add description")}</p><svg class="edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>

    <h3 style="display:flex;align-items:center;gap:0.5rem">Assets (${channels.length}) <button id="add-asset-btn" class="icon-btn" title="Add asset"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></button></h3>
    <div id="asset-badges" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.75rem 0">
      ${assetBadges}
    </div>

    <div id="asset-modal" class="modal-overlay" hidden>
      <div class="modal">
        <div class="modal-header"><h3 style="margin:0">Add Asset</h3><button id="close-modal" class="icon-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:1rem">
          Add a new asset. If it was previously disabled, it will be re-enabled automatically.
          New assets require <strong>2 wallet signatures</strong>.
        </p>
        <div class="form-group">
          <label>Asset Code</label>
          <input type="text" id="new-asset-code" placeholder="e.g. USDC" />
        </div>
        <div class="form-group">
          <label>Asset Issuer</label>
          <input type="text" id="new-asset-issuer" placeholder="G..." />
        </div>
        <div id="asset-steps" style="margin:0.5rem 0" hidden>
          <div id="astep-progress" class="deploy-step"></div>
        </div>
        <p id="asset-error" class="error-text" hidden></p>
        <button id="deploy-asset-btn" class="btn-primary btn-wide" style="margin-top:0.5rem">Add Asset</button>
      </div>
    </div>

    <h3>Providers (${providers.length})</h3>
    <div id="providers-list">
      ${providers.length > 0
        ? providers.map((p) => `<div class="list-item mono">${escapeHtml(truncateAddress(p.publicKey))}</div>`).join("")
        : `<p style="color:var(--text-muted)">No providers</p>`}
    </div>

    <h3 style="display:flex;align-items:center;gap:0.5rem">Requests <button class="icon-btn copy-join-link" title="Copy join link"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button></h3>
    <div id="requests-list"><p style="color:var(--text-muted)">Loading...</p></div>
  `;

  // --- Jurisdiction map (always shown, clickable) ---
  const mapContainer = el.querySelector("#jurisdiction-map") as HTMLDivElement;
  renderJurisdictionMap(jurisdictions).then((svg) => {
    if (!svg) return;
    mapContainer.innerHTML = svg;

    // Click handler for all countries
    mapContainer.addEventListener("click", async (e) => {
      const target = (e.target as Element).closest("[data-country]") as HTMLElement | null;
      if (!target) return;
      const code = target.dataset.country!;
      const { getCountryName } = await import("../lib/world-map.ts");
      const name = getCountryName(code);
      const isSelected = jurisdictions.includes(code);

      if (isSelected) {
        if (!confirm(`Remove ${name} (${code}) from jurisdictions?`)) return;
        if (isPlatformAuthed()) {
          try {
            const { removeJurisdiction } = await import("../lib/platform.ts");
            await removeJurisdiction(code);
            navigate(`/council?id=${encodeURIComponent(councilId)}`, { force: true });
          } catch (err) {
            console.warn("Failed to remove jurisdiction:", err);
          }
        }
      } else {
        if (!confirm(`Add ${name} (${code}) to jurisdictions?`)) return;
        if (isPlatformAuthed()) {
          try {
            const { addJurisdiction } = await import("../lib/platform.ts");
            await addJurisdiction(code, name);
            navigate(`/council?id=${encodeURIComponent(councilId)}`, { force: true });
          } catch (err) {
            console.warn("Failed to add jurisdiction:", err);
          }
        }
      }
    });
  });

  // --- Inline editing (pushes directly to platform) ---
  el.querySelectorAll(".inline-edit").forEach((wrapper) => {
    wrapper.addEventListener("click", (e) => {
      if ((wrapper as HTMLElement).querySelector(".inline-edit-input")) return;
      e.stopPropagation();

      const field = (wrapper as HTMLElement).dataset.field!;
      const displayEl = wrapper.querySelector("h2, span, p") as HTMLElement;
      const placeholder = field === "name" ? "Unnamed Council" : field === "contactEmail" ? "add email" : "add description";
      const currentValue = displayEl.textContent === placeholder ? "" : (displayEl.textContent || "");

      const isTextarea = field === "description";
      const input = document.createElement(isTextarea ? "textarea" : "input") as HTMLInputElement | HTMLTextAreaElement;
      input.className = `inline-edit-input edit-${field === "name" ? "title" : field === "contactEmail" ? "email" : "description"}`;
      input.value = currentValue;
      if (isTextarea) { (input as HTMLTextAreaElement).rows = 3; input.style.resize = "vertical"; }

      const icon = wrapper.querySelector(".edit-icon") as SVGElement;
      if (icon) icon.style.display = "none";
      displayEl.hidden = true;
      wrapper.insertBefore(input, displayEl);
      input.focus();
      input.select();

      function save() {
        const newValue = input.value.trim();
        input.remove();
        displayEl.hidden = false;
        if (icon) icon.style.display = "";

        if (newValue !== currentValue) {
          displayEl.textContent = newValue || placeholder;
          // Push directly to platform DB
          if (isPlatformConfigured() && isPlatformAuthed()) {
            // Read current values from DOM to avoid stale closure
            const nameEl = el.querySelector('.inline-edit[data-field="name"] h2') as HTMLElement;
            const emailEl = el.querySelector('.inline-edit[data-field="contactEmail"] span') as HTMLElement;
            const descEl = el.querySelector('.inline-edit[data-field="description"] p') as HTMLElement;
            const currentName = nameEl?.textContent === "Unnamed Council" ? "" : (nameEl?.textContent || "");
            const currentEmail = emailEl?.textContent === "add email" ? "" : (emailEl?.textContent || "");
            const currentDesc = descEl?.textContent === "add description" ? "" : (descEl?.textContent || "");
            pushMetadata({
              name: currentName || "Unnamed Council",
              description: currentDesc || undefined,
              contactEmail: currentEmail || undefined,
            }).then(() => {
              // Brief green flash to confirm save
              displayEl.style.color = "var(--active)";
              setTimeout(() => { displayEl.style.color = ""; }, 1000);
            }).catch(() => {
              displayEl.style.color = "var(--inactive)";
              displayEl.textContent = (displayEl.textContent || "") + " (save failed)";
            });
          }
        }
      }

      function cancel() { input.remove(); displayEl.hidden = false; if (icon) icon.style.display = ""; }

      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !isTextarea) { e.preventDefault(); input.removeEventListener("blur", save); save(); }
        if (e.key === "Escape") { input.removeEventListener("blur", save); cancel(); }
      });
    });
  });

  // --- Copy buttons ---
  const baseInviteUrl = PLATFORM_URL || `${window.location.origin}${window.location.pathname}#/join`;
  const councilInviteLink = councilId ? `${baseInviteUrl}?council=${councilId}` : baseInviteUrl;

  el.querySelector(".copy-invite-link")?.addEventListener("click", () => {
    const link = councilInviteLink;
    const btn = el.querySelector(".copy-invite-link") as HTMLButtonElement;
    navigator.clipboard.writeText(link).then(() => {
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    });
  });

  el.querySelectorAll(".copy-contract, .copy-admin").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = (btn as HTMLElement).dataset.value;
      if (!value) return;
      navigator.clipboard.writeText(value).then(() => {
        const original = btn.querySelector("svg")!.outerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
        setTimeout(() => { btn.innerHTML = original; }, 1500);
      });
    });
  });

  // --- Asset modal ---
  const modal = el.querySelector("#asset-modal") as HTMLDivElement;
  function onEscKey(e: KeyboardEvent) { if (e.key === "Escape") closeModal(); }
  function openModal() { modal.hidden = false; document.addEventListener("keydown", onEscKey); }
  function closeModal() { modal.hidden = true; document.removeEventListener("keydown", onEscKey); }

  el.querySelector("#add-asset-btn")?.addEventListener("click", openModal);
  el.querySelector("#close-modal")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  // --- Remove asset (disable on platform) ---
  el.querySelectorAll(".asset-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const assetCode = (btn as HTMLElement).dataset.asset!;
      const contractId = (btn as HTMLElement).dataset.contract!;
      if (!confirm(`Disable ${assetCode}? You can re-enable it later.`)) return;

      try {
        const platformChannels = await listChannels();
        const ch = platformChannels.find((c) => c.channelContractId === contractId);
        if (ch) await disableChannel(ch.id);
        capture("council_asset_disabled", { assetCode });
        navigate(`/council?id=${encodeURIComponent(councilId)}`, { force: true });
      } catch (err) {
        console.warn("Failed to disable asset:", err);
      }
    });
  });

  // --- Copy join link ---
  el.querySelector(".copy-join-link")?.addEventListener("click", () => {
    const link = councilInviteLink;
    const btn = el.querySelector(".copy-join-link") as HTMLButtonElement;
    navigator.clipboard.writeText(link).then(() => {
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    });
  });

  // --- Load requests ---
  const requestsList = el.querySelector("#requests-list") as HTMLDivElement;

  function renderRequestsList(requests: import("../lib/platform.ts").JoinRequest[]) {
    if (requests.length === 0) {
      requestsList.innerHTML = `<p style="color:var(--text-muted)">No requests</p>`;
      return;
    }
    requestsList.innerHTML = requests.map((r) => {
      const flags = (r.jurisdictions || []).map((code) => {
        const flag = code.toUpperCase().replace(/./g, (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
        return `<span title="${escapeHtml(code)}">${flag}</span>`;
      }).join(" ");
      return `
        <div class="list-item" style="padding:0.75rem 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
            <span class="mono" style="font-size:0.8rem">${escapeHtml(truncateAddress(r.publicKey))}</span>
            <span class="badge badge-${r.status === "PENDING" ? "pending" : r.status === "APPROVED" ? "active" : "inactive"}">${escapeHtml(r.status)}</span>
          </div>
          <div style="display:flex;gap:1rem;font-size:0.8rem;color:var(--text-muted);flex-wrap:wrap">
            ${r.label ? `<span>${escapeHtml(r.label)}</span>` : ""}
            ${r.contactEmail ? `<span>${escapeHtml(r.contactEmail)}</span>` : ""}
            ${flags ? `<span>${flags}</span>` : ""}
          </div>
          ${r.status === "PENDING" ? `
            <div style="margin-top:0.5rem;display:flex;gap:0.5rem">
              <button class="btn-link approve-req" data-id="${escapeHtml(r.id)}" data-pk="${escapeHtml(r.publicKey)}" style="color:var(--active);font-size:0.8rem">Approve (1 signature)</button>
              <button class="btn-link reject-req" data-id="${escapeHtml(r.id)}" style="color:var(--inactive);font-size:0.8rem">Reject</button>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    // Wire approve/reject
    requestsList.querySelectorAll(".approve-req").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const providerPk = (btn as HTMLElement).dataset.pk!;
        (btn as HTMLButtonElement).disabled = true;
        (btn as HTMLButtonElement).textContent = "Building tx...";
        try {
          // 1. Build add_provider transaction client-side
          const { buildInvokeContractTx, submitTx } = await import("../lib/stellar.ts");
          const { signTransaction } = await import("../lib/wallet.ts");
          const stellar = await (await import("../lib/stellar.ts")).sdk();
          const providerAddress = stellar.nativeToScVal(
            stellar.Address.fromString(providerPk),
            { type: "address" },
          );

          const txXdr = await buildInvokeContractTx(
            councilId!,
            "add_provider",
            [providerAddress],
            adminAddress,
          );

          // 2. Admin signs with wallet
          (btn as HTMLButtonElement).textContent = "Sign in wallet...";
          const signedXdr = await signTransaction(txXdr);

          // 3. Submit to network
          (btn as HTMLButtonElement).textContent = "Submitting...";
          await submitTx(signedXdr);

          // 4. Tell platform the request is approved (DB update)
          (btn as HTMLButtonElement).textContent = "Confirming...";
          const { approveJoinRequest, listJoinRequests } = await import("../lib/platform.ts");
          const { callbackEndpoint, configPayload } = await approveJoinRequest(id);

          // 5. Sign config payload and push to PP's callback endpoint
          if (callbackEndpoint && configPayload) {
            (btn as HTMLButtonElement).textContent = "Pushing config...";
            const { signMessage } = await import("../lib/wallet.ts");
            const { getConnectedAddress } = await import("../lib/wallet.ts");
            const configJson = JSON.stringify(configPayload);
            const configSig = await signMessage(configJson);
            const signedConfig = {
              payload: configPayload,
              signature: configSig,
              publicKey: getConnectedAddress(),
            };
            const pushUrl = `${callbackEndpoint.replace(/\/+$/, "")}/api/v1/council/config-push`;
            const pushRes = await fetch(pushUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(signedConfig),
            });
            if (!pushRes.ok) {
              const pushErr = await pushRes.json().catch(() => ({}));
              throw new Error(pushErr.message || `Config push failed: ${pushRes.status}`);
            }
          }

          capture("council_join_request_approved", { requestId: id });
          const updated = await listJoinRequests();
          renderRequestsList(updated);
        } catch (err) {
          console.error("Failed to approve:", err);
          (btn as HTMLButtonElement).textContent = "Failed";
          (btn as HTMLButtonElement).disabled = false;
        }
      });
    });
    requestsList.querySelectorAll(".reject-req").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.id!;
        if (!confirm("Reject this join request?")) return;
        (btn as HTMLButtonElement).disabled = true;
        try {
          const { rejectJoinRequest, listJoinRequests } = await import("../lib/platform.ts");
          await rejectJoinRequest(id);
          capture("council_join_request_rejected", { requestId: id });
          const updated = await listJoinRequests();
          renderRequestsList(updated);
        } catch (err) {
          console.error("Failed to reject:", err);
          (btn as HTMLButtonElement).textContent = "Failed";
        }
      });
    });
  }

  if (isPlatformAuthed()) {
    import("../lib/platform.ts").then(({ listJoinRequests }) => {
      listJoinRequests().then(renderRequestsList).catch(() => {
        requestsList.innerHTML = `<p style="color:var(--text-muted)">No requests</p>`;
      });
    });
  } else {
    requestsList.innerHTML = `<p style="color:var(--text-muted)">No requests</p>`;
  }

  // --- Deploy new asset ---
  const deployBtn = el.querySelector("#deploy-asset-btn") as HTMLButtonElement;
  const stepsEl = el.querySelector("#asset-steps") as HTMLDivElement;
  const assetErrorEl = el.querySelector("#asset-error") as HTMLParagraphElement;


  deployBtn.addEventListener("click", async () => {
    const admin = getConnectedAddress();
    if (!admin) { assetErrorEl.textContent = "Connect your wallet first"; assetErrorEl.hidden = false; return; }

    const assetCode = (el.querySelector("#new-asset-code") as HTMLInputElement).value.trim();
    const assetIssuer = (el.querySelector("#new-asset-issuer") as HTMLInputElement).value.trim();
    if (!assetCode) { assetErrorEl.textContent = "Asset code is required"; assetErrorEl.hidden = false; return; }

    deployBtn.disabled = true;
    deployBtn.textContent = "Checking...";
    assetErrorEl.hidden = true;

    // Tier 1: Check platform DB — already active or disabled?
    if (isPlatformConfigured() && isPlatformAuthed()) {
      try {
        const active = await listChannels();
        if (active.find((ch) => ch.assetCode.toUpperCase() === assetCode.toUpperCase())) {
          modal.hidden = true;
          navigate(`/council?id=${encodeURIComponent(councilId)}`, { force: true });
          return;
        }
        const disabled = await listDisabledChannels();
        const match = disabled.find((ch) => ch.assetCode.toUpperCase() === assetCode.toUpperCase());
        if (match) {
          await enableChannel(match.id);
          capture("council_asset_reenabled", { assetCode });
          modal.hidden = true;
          navigate(`/council?id=${encodeURIComponent(councilId)}`, { force: true });
          return;
        }
      } catch (err) {
        console.error("[add-asset] platform check failed:", err);
      }
    }

    // Tier 2: Try to find an already-deployed channel via deterministic address derivation.
    // Contract address depends only on deployer + salt (not WASM hash).
    deployBtn.textContent = "Searching on-chain...";
    try {
      const { computeDeploySalt, deriveContractAddress, getAssetContractId, sdk: getSdk, getRpcServer } = await import("../lib/stellar.ts");
      const stellar = await getSdk();
      const server = await getRpcServer();
      const { getNetworkPassphrase } = await import("../lib/config.ts");

      const assetSalt = await computeDeploySalt(councilId, assetCode, assetIssuer);
      const derivedAddress = await deriveContractAddress(admin, assetSalt);

      const contract = new stellar.Contract(derivedAddress);
      const account = await server.getAccount(admin);
      const tx = new stellar.TransactionBuilder(account, { fee: "100", networkPassphrase: getNetworkPassphrase() })
        .addOperation(contract.call("auth"))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (!("error" in sim && sim.error)) {
        // Found it — register with platform
        if (isPlatformAuthed()) {
          const sacId = await getAssetContractId(assetCode, assetIssuer || undefined);
          await registerChannel({ channelContractId: derivedAddress, assetCode, assetContractId: sacId, issuerAddress: assetIssuer, label: `${assetCode} Privacy Channel` });
        }
        capture("council_asset_found", { assetCode, channelId: derivedAddress });
        modal.hidden = true;
        navigate(`/council?id=${encodeURIComponent(councilId)}`, { force: true });
        return;
      }
    } catch {
      // Not found at derived address — proceed to deploy
    }

    deployBtn.textContent = "Deploying...";
    stepsEl.hidden = false;

    const { traceId } = startTrace();
    try {
      const { fetchWasm, buildInstallWasmTx, buildDeployContractTx, computeDeploySalt, submitTx, getAssetContractId, sdk: getSdk } = await import("../lib/stellar.ts");
      const { nativeToScVal, Address } = await getSdk();
      const { signTransaction } = await import("../lib/wallet.ts");

      const progressEl = el.querySelector("#astep-progress") as HTMLDivElement;
      progressEl.textContent = `Enabling ${assetCode} (1/2)`;
      progressEl.className = "deploy-step deploy-step-active";
      let channelWasmHash!: Uint8Array;
      await withSpan("asset.install_wasm", traceId, async () => {
        const wasm = await fetchWasm("privacy_channel");
        const { xdr, wasmHash } = await buildInstallWasmTx(wasm, admin);
        channelWasmHash = wasmHash;
        await submitTx(await signTransaction(xdr));
      });
      progressEl.textContent = `Enabling ${assetCode} (2/2)`;

      let newChannelId!: string;
      let assetContractId!: string;
      await withSpan("asset.deploy_channel", traceId, async () => {
        assetContractId = await getAssetContractId(assetCode, assetIssuer || undefined);
        const args = [
          nativeToScVal(Address.fromString(admin), { type: "address" }),
          nativeToScVal(Address.fromString(councilId), { type: "address" }),
          nativeToScVal(Address.fromString(assetContractId), { type: "address" }),
        ];
        const assetSalt = await computeDeploySalt(councilId, assetCode, assetIssuer);
        const xdr = await buildDeployContractTx(channelWasmHash, admin, args, assetSalt);
        const { contractId } = await submitTx(await signTransaction(xdr));
        if (!contractId) throw new Error("Failed to deploy asset");
        newChannelId = contractId;
      });
      progressEl.textContent = `${assetCode} enabled`;
      progressEl.className = "deploy-step deploy-step-done";

      // Register on platform
      if (isPlatformAuthed()) {
        try {
          await registerChannel({ channelContractId: newChannelId, assetCode, assetContractId, issuerAddress: assetIssuer, label: `${assetCode} Privacy Channel` });
        } catch { /* best effort */ }
      }

      capture("council_asset_enabled", { channelAuthId: councilId, assetCode, channelId: newChannelId });
      modal.hidden = true;
      navigate(`/council?id=${encodeURIComponent(councilId)}`, { force: true });
    } catch (error) {
      const msg = friendlyError(error);
      capture("council_asset_enable_failed", { error: msg });
      assetErrorEl.textContent = msg;
      assetErrorEl.hidden = false;
      deployBtn.disabled = false;
      deployBtn.textContent = "Add Asset";
    }
  });

  return el;
}

export const councilDetailView = page(renderContent);
