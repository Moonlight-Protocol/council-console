import { page } from "../components/page.ts";
import { addCouncil } from "../lib/store.ts";
import { navigate } from "../lib/router.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { escapeHtml } from "../lib/dom.ts";
import { capture } from "../lib/analytics.ts";
import { startTrace, withSpan } from "../lib/tracer.ts";
import { COUNTRY_CODES } from "../lib/jurisdictions.ts";
import { FRIENDBOT_URL, STELLAR_NETWORK } from "../lib/config.ts";
import {
  addJurisdiction,
  authenticate,
  isPlatformConfigured,
  pushMetadata,
  registerChannel,
} from "../lib/platform.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  const adminAddress = getConnectedAddress();

  el.innerHTML = `
    <h2>Deploy New Council</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Deploy a Channel Auth contract and a Privacy Channel contract.
      WASMs are fetched from the latest soroban-core GitHub release.
    </p>

    <div class="deploy-form">
      <div class="stats-row">
        <div class="stat-card">
          <span class="stat-label">Admin</span>
          <span class="stat-value mono" style="font-size:0.7rem">${
    escapeHtml(adminAddress || "Not connected")
  }</span>
        </div>
        <div class="stat-card" id="balance-card">
          <span class="stat-label">XLM Balance</span>
          <span id="balance-value" class="stat-value" style="font-size:1rem;color:var(--text-muted)">Loading...</span>
        </div>
      </div>

      <div id="balance-warning" class="balance-warning" hidden>
        <strong>Insufficient funds.</strong> You need at least ~20 XLM to cover contract deployment fees.
        Fund this address:
        <span class="mono" style="font-size:0.75rem;word-break:break-all">${
    escapeHtml(adminAddress || "")
  }</span>
        ${
    (STELLAR_NETWORK === "testnet" || STELLAR_NETWORK === "standalone")
      ? `<br><a href="${escapeHtml(FRIENDBOT_URL)}?addr=${
        escapeHtml(adminAddress || "")
      }" target="_blank" rel="noopener" style="color:var(--primary)">Fund via Friendbot</a>`
      : ""
  }
      </div>

      <div class="form-group">
        <label>Council Label (optional)</label>
        <input type="text" id="council-label" placeholder="e.g. Moonlight Beta" />
      </div>

      <div class="form-group">
        <label>Description (optional)</label>
        <textarea id="council-description" rows="3" maxlength="500"
          placeholder="Brief description of this council's purpose"
          style="width:100%;padding:0.6rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.875rem;font-family:var(--font-sans);resize:vertical"></textarea>
        <p class="hint-text" style="margin-top:0.25rem">Max 500 characters.</p>
      </div>

      <div class="form-group">
        <label>Contact Email (optional)</label>
        <input type="email" id="council-email" placeholder="admin@example.com" />
      </div>

      <div class="form-group">
        <label>Jurisdictions (optional)</label>
        <div id="jurisdiction-tags" class="jurisdiction-tags"></div>
        <div class="jurisdiction-picker">
          <input type="text" id="jurisdiction-filter" placeholder="Search countries..." style="border:none;border-bottom:1px solid var(--border);border-radius:0;position:sticky;top:0;background:var(--bg);z-index:1" />
          <div id="jurisdiction-list" class="jurisdiction-list"></div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Asset Code</label>
          <input type="text" id="asset-code" value="XLM" />
        </div>
        <div class="form-group">
          <label>Asset Issuer (empty for native XLM)</label>
          <input type="text" id="asset-issuer" placeholder="G... or empty for native" />
        </div>
      </div>

      <div class="form-group">
        <label>Release Version</label>
        <input type="text" id="release-version" value="latest" placeholder="latest or v0.1.0" />
        <p class="hint-text" style="margin-top:0.25rem">soroban-core release tag to fetch WASMs from.</p>
      </div>

      <button id="deploy-btn" class="btn-primary btn-wide" style="margin-top:1rem">Deploy Contracts</button>

      <div id="deploy-steps" style="margin-top:1.5rem" hidden>
        <div id="step-fetch" class="deploy-step">Fetch WASMs from release</div>
        <div id="step-install-auth" class="deploy-step">Install Channel Auth WASM</div>
        <div id="step-deploy-auth" class="deploy-step">Deploy Channel Auth</div>
        <div id="step-install-channel" class="deploy-step">Install Privacy Channel WASM</div>
        <div id="step-deploy-channel" class="deploy-step">Deploy Privacy Channel</div>
        <div id="step-platform" class="deploy-step" ${
    isPlatformConfigured() ? "" : "hidden"
  }>Register with council platform</div>
      </div>

      <p id="deploy-error" class="error-text" hidden></p>

      <div id="deploy-result" hidden style="margin-top:1.5rem">
        <h3>Deployment Complete</h3>
        <div class="stats-row">
          <div class="stat-card active">
            <span class="stat-label">Channel Auth</span>
            <span id="result-auth-id" class="stat-value mono" style="font-size:0.8rem"></span>
          </div>
          <div class="stat-card active">
            <span class="stat-label">Privacy Channel</span>
            <span id="result-channel-id" class="stat-value mono" style="font-size:0.8rem"></span>
          </div>
        </div>
        <div style="display:flex;gap:0.75rem">
          <button id="goto-council" class="btn-primary">View Council</button>
          <button id="goto-providers" class="btn-primary" style="background:var(--border)">Add Privacy Providers</button>
        </div>
      </div>
    </div>
  `;

  // --- Balance check ---
  if (adminAddress) {
    import("../lib/stellar.ts").then(({ getAccountBalance }) => {
      getAccountBalance(adminAddress).then(({ xlm, funded }) => {
        const balanceEl = el.querySelector("#balance-value") as HTMLElement;
        const warningEl = el.querySelector(
          "#balance-warning",
        ) as HTMLDivElement;
        const cardEl = el.querySelector("#balance-card") as HTMLDivElement;

        if (!funded) {
          balanceEl.textContent = "Not funded";
          balanceEl.style.color = "var(--inactive)";
          warningEl.hidden = false;
        } else {
          const balance = parseFloat(xlm);
          balanceEl.textContent = `${balance.toFixed(2)} XLM`;
          if (balance < 20) {
            balanceEl.style.color = "var(--pending)";
            cardEl.classList.add("pending");
            warningEl.hidden = false;
          } else {
            balanceEl.style.color = "var(--active)";
            cardEl.classList.add("active");
          }
        }
      });
    });
  }

  // --- Jurisdiction picker ---
  const selectedJurisdictions = new Set<string>();
  const tagsEl = el.querySelector("#jurisdiction-tags") as HTMLDivElement;
  const listEl = el.querySelector("#jurisdiction-list") as HTMLDivElement;
  const filterEl = el.querySelector("#jurisdiction-filter") as HTMLInputElement;

  function renderJurisdictionTags() {
    tagsEl.innerHTML = "";
    for (const code of selectedJurisdictions) {
      const entry = COUNTRY_CODES.find((c) => c.code === code);
      if (!entry) continue;
      const tag = document.createElement("span");
      tag.className = "jurisdiction-tag";
      tag.textContent = `${entry.code} `;
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "\u00d7";
      removeBtn.style.cssText =
        "background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0 0 0 0.25rem;font-size:1rem";
      removeBtn.addEventListener("click", () => {
        selectedJurisdictions.delete(code);
        renderJurisdictionTags();
        renderJurisdictionList(filterEl.value);
      });
      tag.appendChild(removeBtn);
      tagsEl.appendChild(tag);
    }
  }

  function renderJurisdictionList(filter: string) {
    listEl.innerHTML = "";
    const query = filter.toLowerCase();
    const filtered = COUNTRY_CODES.filter(
      (c) =>
        c.label.toLowerCase().includes(query) ||
        c.code.toLowerCase().includes(query),
    );
    for (const country of filtered) {
      const selected = selectedJurisdictions.has(country.code);
      const option = document.createElement("div");
      option.className = "jurisdiction-option" + (selected ? " selected" : "");
      const flag = country.code.toUpperCase().replace(
        /./g,
        (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65),
      );
      option.textContent = `${flag} ${country.label}`;
      option.addEventListener("click", () => {
        if (selected) selectedJurisdictions.delete(country.code);
        else selectedJurisdictions.add(country.code);
        renderJurisdictionTags();
        if (!selected) {
          filterEl.value = "";
          renderJurisdictionList("");
        } else renderJurisdictionList(filterEl.value);
      });
      listEl.appendChild(option);
    }
  }

  renderJurisdictionList("");
  filterEl.addEventListener(
    "input",
    () => renderJurisdictionList(filterEl.value),
  );

  // --- Deploy handler ---
  const btn = el.querySelector("#deploy-btn") as HTMLButtonElement;
  const stepsEl = el.querySelector("#deploy-steps") as HTMLDivElement;
  const errorEl = el.querySelector("#deploy-error") as HTMLParagraphElement;
  const resultEl = el.querySelector("#deploy-result") as HTMLDivElement;

  function setStep(stepId: string, status: "active" | "done" | "error") {
    const stepEl = el.querySelector(`#${stepId}`) as HTMLDivElement;
    if (!stepEl) return;
    stepEl.className = `deploy-step deploy-step-${status}`;
  }

  btn.addEventListener("click", async () => {
    if (!adminAddress) {
      errorEl.textContent = "Connect your wallet first";
      errorEl.hidden = false;
      return;
    }

    btn.disabled = true;
    errorEl.hidden = true;
    stepsEl.hidden = false;

    const { traceId } = startTrace();

    try {
      const label = (el.querySelector("#council-label") as HTMLInputElement)
        .value.trim();
      const description =
        (el.querySelector("#council-description") as HTMLTextAreaElement).value
          .trim();
      const contactEmail =
        (el.querySelector("#council-email") as HTMLInputElement).value.trim();
      const jurisdictions = Array.from(selectedJurisdictions);
      const assetCode = (el.querySelector("#asset-code") as HTMLInputElement)
        .value.trim();
      const assetIssuer =
        (el.querySelector("#asset-issuer") as HTMLInputElement).value.trim();

      const {
        fetchWasm,
        buildInstallWasmTx,
        buildDeployContractTx,
        submitTx,
        ensureSacDeployed,
        sdk: getSdk,
      } = await import("../lib/stellar.ts");
      const { nativeToScVal, Address } = await getSdk();
      const { signTransaction } = await import("../lib/wallet.ts");

      // 1. Fetch WASMs
      setStep("step-fetch", "active");
      let authWasm!: Uint8Array;
      let channelWasm!: Uint8Array;
      await withSpan("deploy.fetch_wasms", traceId, async () => {
        authWasm = await fetchWasm("channel_auth_contract");
        channelWasm = await fetchWasm("privacy_channel");
      });
      setStep("step-fetch", "done");

      // 2. Install Channel Auth WASM
      setStep("step-install-auth", "active");
      let authWasmHash!: Uint8Array;
      await withSpan("deploy.install_channel_auth", traceId, async () => {
        const { xdr, wasmHash } = await buildInstallWasmTx(
          authWasm,
          adminAddress,
        );
        authWasmHash = wasmHash;
        const signed = await signTransaction(xdr);
        await submitTx(signed);
      });
      setStep("step-install-auth", "done");

      // 3. Deploy Channel Auth
      setStep("step-deploy-auth", "active");
      let channelAuthId!: string;
      await withSpan("deploy.deploy_channel_auth", traceId, async () => {
        const adminScVal = nativeToScVal(Address.fromString(adminAddress), {
          type: "address",
        });
        const xdr = await buildDeployContractTx(authWasmHash, adminAddress, [
          adminScVal,
        ]);
        const signed = await signTransaction(xdr);
        const { contractId } = await submitTx(signed);
        if (!contractId) {
          throw new Error("Failed to extract Channel Auth contract ID");
        }
        channelAuthId = contractId;
      });
      setStep("step-deploy-auth", "done");

      // 4. Install Privacy Channel WASM
      setStep("step-install-channel", "active");
      let channelWasmHash!: Uint8Array;
      await withSpan("deploy.install_privacy_channel", traceId, async () => {
        const { xdr, wasmHash } = await buildInstallWasmTx(
          channelWasm,
          adminAddress,
        );
        channelWasmHash = wasmHash;
        const signed = await signTransaction(xdr);
        await submitTx(signed);
      });
      setStep("step-install-channel", "done");

      // 5. Deploy Privacy Channel
      setStep("step-deploy-channel", "active");
      let privacyChannelId!: string;
      await withSpan("deploy.deploy_privacy_channel", traceId, async () => {
        const assetAddress = await ensureSacDeployed(
          assetCode,
          assetIssuer || undefined,
          adminAddress,
          signTransaction,
        );
        const channelArgs = [
          nativeToScVal(Address.fromString(adminAddress), { type: "address" }),
          nativeToScVal(Address.fromString(channelAuthId), { type: "address" }),
          nativeToScVal(Address.fromString(assetAddress), { type: "address" }),
        ];
        const xdr = await buildDeployContractTx(
          channelWasmHash,
          adminAddress,
          channelArgs,
        );
        const signed = await signTransaction(xdr);
        const { contractId } = await submitTx(signed);
        if (!contractId) {
          throw new Error("Failed to extract Privacy Channel contract ID");
        }
        privacyChannelId = contractId;
      });
      setStep("step-deploy-channel", "done");

      // 6. Store locally
      addCouncil({
        channelAuthId,
        privacyChannelId,
        assetCode,
        assetIssuer: assetIssuer || undefined,
        adminAddress,
        providers: [],
        createdAt: new Date().toISOString(),
        label: label || undefined,
        jurisdictions: jurisdictions.length > 0 ? jurisdictions : undefined,
        contactEmail: contactEmail || undefined,
        description: description || undefined,
      });

      // 7. Push to platform (best-effort)
      if (isPlatformConfigured()) {
        setStep("step-platform", "active");
        try {
          await withSpan("deploy.platform_push", traceId, async () => {
            await authenticate();
            await pushMetadata({
              name: label || "Unnamed Council",
              description: description || undefined,
              contactEmail: contactEmail || undefined,
            });
            for (const code of jurisdictions) {
              const entry = COUNTRY_CODES.find((c) => c.code === code);
              await addJurisdiction(code, entry?.label);
            }
            const assetContractId = await getAssetContractId(
              assetCode,
              assetIssuer || undefined,
            );
            await registerChannel({
              channelContractId: privacyChannelId,
              assetCode,
              assetContractId,
              label: `${assetCode} Privacy Channel`,
            });
          });
          setStep("step-platform", "done");
        } catch (err) {
          setStep("step-platform", "error");
          console.warn("Platform registration failed:", err);
        }
      }

      capture("council_deploy_complete", {
        channelAuthId,
        privacyChannelId,
        assetCode,
        adminAddress,
      });

      btn.hidden = true;
      resultEl.hidden = false;
      (el.querySelector("#result-auth-id") as HTMLElement).textContent =
        channelAuthId;
      (el.querySelector("#result-channel-id") as HTMLElement).textContent =
        privacyChannelId;

      el.querySelector("#goto-council")?.addEventListener("click", () => {
        navigate(`/council?id=${encodeURIComponent(channelAuthId)}`);
      });
      el.querySelector("#goto-providers")?.addEventListener("click", () => {
        navigate(`/providers?council=${encodeURIComponent(channelAuthId)}`);
      });
    } catch (error) {
      capture("council_deploy_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      errorEl.textContent = error instanceof Error
        ? error.message
        : String(error);
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });

  return el;
}

export const deployView = page(renderContent);
