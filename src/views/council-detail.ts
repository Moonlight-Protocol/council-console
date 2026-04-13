import { page } from "../components/page.ts";
import { escapeHtml, truncateAddress, friendlyError } from "../lib/dom.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { capture } from "../lib/analytics.ts";
import { startTrace, withSpan } from "../lib/tracer.ts";
import { navigate } from "../lib/router.ts";
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
import { COUNTRY_CODES } from "../lib/jurisdictions.ts";
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
  const state = await fetchCouncilState(councilId!);
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
    <div class="council-header"><a href="#/" class="icon-btn" title="Back" style="color:var(--text)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></a><span class="inline-edit" data-field="name"><h2>${escapeHtml(council.name || "Unnamed Council")}</h2><svg class="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span><span class="inline-edit" data-field="contactEmail"><span style="color:var(--text-muted);font-size:0.75rem">${escapeHtml(state.contactEmail || "add email")}</span><svg class="edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span><div class="header-icons"><button class="icon-btn copy-contract" data-value="${escapeHtml(councilId)}" title="Copy Council address"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 16H8"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/></svg></button><button class="icon-btn copy-invite-link" title="Copy invite link"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button></div></div>

    <div id="jurisdiction-map" class="jurisdiction-map"></div>
    <div class="inline-edit" data-field="description" style="margin:0.75rem 0"><p style="color:var(--text-muted);font-size:0.85rem;margin:0">${escapeHtml(state.description || "add description")}</p><svg class="edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>

    <h3 style="display:flex;align-items:center;gap:0.5rem">Assets (${channels.length}) <button id="add-asset-btn" class="icon-btn" title="Add asset"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button></h3>
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

    <h3 style="display:flex;align-items:center;gap:0.5rem">Providers <button class="icon-btn copy-join-link" title="Copy join link"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button></h3>
    <div id="providers-list"><p style="color:var(--text-muted)">Loading...</p></div>
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
            await removeJurisdiction(councilId!, code);
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
            await addJurisdiction(councilId!, code, name);
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
              councilId: councilId!,
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
  const baseInviteUrl = `${window.location.origin}${window.location.pathname}#/join`;
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

  el.querySelectorAll(".copy-contract").forEach((btn) => {
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
        const platformChannels = await listChannels(councilId!);
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

  // --- Load providers (unified: active + requested + rejected + removed) ---
  const providersList = el.querySelector("#providers-list") as HTMLDivElement;

  interface ProviderEntry {
    publicKey: string;
    label: string | null;
    contactEmail: string | null;
    jurisdictions: string[] | null;
    status: "Active" | "Requested" | "Approved" | "Rejected" | "Removed";
    date: string;
    requestId?: string;
  }

  function statusBadgeClass(status: string): string {
    switch (status) {
      case "Active": return "active";
      case "Requested": return "pending";
      case "Approved": return "active";
      case "Rejected": return "inactive";
      case "Removed": return "inactive";
      default: return "pending";
    }
  }

  function renderProviderRow(p: ProviderEntry): string {
    const flags = (p.jurisdictions || []).map((code) => {
      const flag = code.toUpperCase().replace(/./g, (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
      return `<span title="${escapeHtml(code)}">${flag}</span>`;
    }).join(" ");
    const d = new Date(p.date);
    const dateStr = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const fullDate = d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

    return `
      <tr class="provider-row" data-status="${escapeHtml(p.status)}" data-request-id="${escapeHtml(p.requestId || "")}" data-pk="${escapeHtml(p.publicKey)}" style="position:relative">
        <td>${escapeHtml(p.label || truncateAddress(p.publicKey))}</td>
        <td>${escapeHtml(p.contactEmail || "-")}</td>
        <td>${flags || "-"}</td>
        <td title="${escapeHtml(fullDate)}">${escapeHtml(dateStr)}</td>
        <td>
          <span class="badge badge-${statusBadgeClass(p.status)}">${escapeHtml(p.status)}</span>
        </td>
      </tr>
    `;
  }

  function renderProvidersList(entries: ProviderEntry[]) {
    if (entries.length === 0) {
      providersList.innerHTML = `<p style="color:var(--text-muted)">No providers yet. Share the invite link to get started.</p>`;
      return;
    }

    providersList.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Jurisdictions</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>${entries.map(renderProviderRow).join("")}</tbody>
      </table>
      <div id="provider-action-popup" style="display:none;position:fixed;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:0.4rem 0.6rem;box-shadow:0 4px 12px rgba(0,0,0,0.4);z-index:100;white-space:nowrap">
        <button class="btn-link popup-approve" style="color:var(--active);font-size:0.8rem">Approve</button>
        <button class="btn-link popup-reject" style="color:var(--inactive);font-size:0.8rem;margin-left:0.5rem">Reject</button>
      </div>
    `;

    const popup = providersList.querySelector("#provider-action-popup") as HTMLDivElement;
    let activeRowId: string | null = null;
    let popupLocked = false;

    // Hover to show popup on Requested rows
    providersList.querySelectorAll(".provider-row[data-status='Requested']").forEach((row) => {
      row.addEventListener("mouseenter", () => {
        if (popupLocked) return;
        activeRowId = (row as HTMLElement).dataset.requestId || null;
        // Position directly on top of the status badge
        const badge = row.querySelector(".badge") as HTMLElement;
        const rect = badge ? badge.getBoundingClientRect() : (row as HTMLElement).getBoundingClientRect();
        popup.style.top = `${rect.top}px`;
        popup.style.left = `${rect.left}px`;
        popup.style.display = "block";
        popup.dataset.id = (row as HTMLElement).dataset.requestId || "";
        popup.dataset.pk = (row as HTMLElement).dataset.pk || "";
      });
      row.addEventListener("mouseleave", (e) => {
        if (popupLocked) return;
        const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
        if (related && popup.contains(related)) return;
        popup.style.display = "none";
        activeRowId = null;
      });
    });

    popup.addEventListener("mouseleave", (e) => {
      if (popupLocked) return;
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      const activeRow = activeRowId ? providersList.querySelector(`[data-request-id="${CSS.escape(activeRowId)}"]`) : null;
      if (related && activeRow?.contains(related)) return;
      popup.style.display = "none";
      activeRowId = null;
    });

    // Wire popup approve
    const popupApprove = popup.querySelector(".popup-approve") as HTMLButtonElement;
    const popupReject = popup.querySelector(".popup-reject") as HTMLButtonElement;

    popupApprove.addEventListener("click", async () => {
      const id = popup.dataset.id!;
      const providerPk = popup.dataset.pk!;
      popupLocked = true;
      popupApprove.disabled = true;
      popupReject.disabled = true;
      popupApprove.textContent = "Accepting...";
      try {
        const { buildInvokeContractTx, submitTx } = await import("../lib/stellar.ts");
        const { signTransaction } = await import("../lib/wallet.ts");
        const stellar = await (await import("../lib/stellar.ts")).sdk();
        const providerAddress = stellar.nativeToScVal(
          stellar.Address.fromString(providerPk),
          { type: "address" },
        );

        const txXdr = await buildInvokeContractTx(councilId!, "add_provider", [providerAddress], adminAddress);
        const signedXdr = await signTransaction(txXdr);
        await submitTx(signedXdr);

        const { approveJoinRequest } = await import("../lib/platform.ts");
        await approveJoinRequest(id);

        const ppEntry = entries.find((e) => e.publicKey === providerPk);
        if (ppEntry?.jurisdictions?.length && isPlatformAuthed()) {
          const { addJurisdiction } = await import("../lib/platform.ts");
          for (const code of ppEntry.jurisdictions) {
            if (!jurisdictions.includes(code)) {
              const label = COUNTRY_CODES.find((c) => c.code === code)?.label;
              await addJurisdiction(councilId!, code, label).catch(() => {});
            }
          }
        }

        capture("council_join_request_approved", { requestId: id });
        popupLocked = false;
        popup.style.display = "none";
        await loadProviders();
      } catch (err) {
        console.error("Failed to approve:", err);
        popupApprove.textContent = "Failed";
        popupApprove.disabled = false;
        popupReject.disabled = false;
        popupLocked = false;
      }
    });

    popupReject.addEventListener("click", async () => {
      const id = popup.dataset.id!;
      if (!confirm("Reject this provider request?")) return;
      popupLocked = true;
      popupReject.disabled = true;
      popupApprove.disabled = true;
      try {
        const { rejectJoinRequest } = await import("../lib/platform.ts");
        await rejectJoinRequest(id);
        capture("council_join_request_rejected", { requestId: id });
        popupLocked = false;
        popup.style.display = "none";
        await loadProviders();
      } catch (err) {
        console.error("Failed to reject:", err);
        popupReject.textContent = "Failed";
        popupReject.disabled = false;
        popupApprove.disabled = false;
        popupLocked = false;
      }
    });
  }

  async function loadProviders() {
    const entries: ProviderEntry[] = [];

    // Fetch join requests first (has richer data)
    let requests: import("../lib/platform.ts").JoinRequest[] = [];
    if (isPlatformAuthed()) {
      try {
        const { listJoinRequests } = await import("../lib/platform.ts");
        requests = await listJoinRequests(councilId!);
      } catch {
        // Platform not available
      }
    }

    // Build a lookup from join requests by publicKey
    const requestByKey = new Map<string, import("../lib/platform.ts").JoinRequest>();
    for (const r of requests) {
      requestByKey.set(r.publicKey, r);
    }

    // Active providers from council state — enrich with join request data
    for (const p of providers) {
      const req = requestByKey.get(p.publicKey);
      entries.push({
        publicKey: p.publicKey,
        label: req?.label || p.label || null,
        contactEmail: req?.contactEmail || null,
        jurisdictions: req?.jurisdictions || null,
        status: "Active",
        date: req?.reviewedAt || req?.createdAt || new Date().toISOString(),
        requestId: req?.id,
      });
    }

    // Add non-active join requests (Requested, Rejected)
    for (const r of requests) {
      if (entries.some((e) => e.publicKey === r.publicKey)) continue;

      let status: ProviderEntry["status"];
      let date = r.createdAt;
      if (r.status === "PENDING") {
        status = "Requested";
      } else if (r.status === "APPROVED") {
        status = "Active";
        date = r.reviewedAt || r.createdAt;
      } else {
        status = "Rejected";
        date = r.reviewedAt || r.createdAt;
      }

      entries.push({
        publicKey: r.publicKey,
        label: r.label,
        contactEmail: r.contactEmail,
        jurisdictions: r.jurisdictions,
        status,
        date,
        requestId: r.id,
      });
    }

    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    renderProvidersList(entries);
  }

  loadProviders();

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
        const active = await listChannels(councilId!);
        if (active.find((ch) => ch.assetCode.toUpperCase() === assetCode.toUpperCase())) {
          modal.hidden = true;
          navigate(`/council?id=${encodeURIComponent(councilId)}`, { force: true });
          return;
        }
        const disabled = await listDisabledChannels(councilId!);
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
          await registerChannel(councilId!, { channelContractId: derivedAddress, assetCode, assetContractId: sacId, issuerAddress: assetIssuer, label: `${assetCode} Privacy Channel` });
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
      const { fetchWasm, buildInstallWasmTx, buildDeployContractTx, computeDeploySalt, submitTx, ensureSacDeployed, sdk: getSdk } = await import("../lib/stellar.ts");
      const { nativeToScVal, Address } = await getSdk();
      const { signTransaction } = await import("../lib/wallet.ts");

      const progressEl = el.querySelector("#astep-progress") as HTMLDivElement;
      progressEl.textContent = `Enabling ${assetCode}...`;
      progressEl.className = "deploy-step deploy-step-active";
      let channelWasmHash!: Uint8Array;
      await withSpan("asset.install_wasm", traceId, async () => {
        const wasm = await fetchWasm("privacy_channel");
        const { xdr, wasmHash } = await buildInstallWasmTx(wasm, admin);
        channelWasmHash = wasmHash;
        await submitTx(await signTransaction(xdr));
      });

      let newChannelId!: string;
      let assetContractId!: string;
      await withSpan("asset.deploy_channel", traceId, async () => {
        assetContractId = await ensureSacDeployed(assetCode, assetIssuer || undefined, admin, signTransaction);
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
          await registerChannel(councilId!, { channelContractId: newChannelId, assetCode, assetContractId, issuerAddress: assetIssuer, label: `${assetCode} Privacy Channel` });
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
