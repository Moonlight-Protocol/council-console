import { page } from "../components/page.ts";
import { addCouncil } from "../lib/store.ts";
import { navigate } from "../lib/router.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { escapeHtml } from "../lib/dom.ts";
import { capture } from "../lib/analytics.ts";
import { startTrace, withSpan } from "../lib/tracer.ts";

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
          <span class="stat-value mono" style="font-size:0.7rem">${escapeHtml(adminAddress || "Not connected")}</span>
        </div>
      </div>

      <div class="form-group">
        <label>Council Label (optional)</label>
        <input type="text" id="council-label" placeholder="e.g. Moonlight Beta" />
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
        <button id="goto-providers" class="btn-primary">Add Privacy Providers</button>
      </div>
    </div>
  `;

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
      const label = (el.querySelector("#council-label") as HTMLInputElement).value.trim();
      const assetCode = (el.querySelector("#asset-code") as HTMLInputElement).value.trim();
      const assetIssuer = (el.querySelector("#asset-issuer") as HTMLInputElement).value.trim();
      const releaseVersion = (el.querySelector("#release-version") as HTMLInputElement).value.trim() || "latest";

      const {
        fetchWasmFromRelease,
        buildInstallWasmTx,
        buildDeployContractTx,
        submitTx,
        getAssetContractId,
      } = await import("../lib/stellar.ts");
      const stellar = await import("stellar-sdk");
      const { nativeToScVal, Address } = stellar;
      const { signTransaction } = await import("../lib/wallet.ts");

      // 1. Fetch WASMs
      setStep("step-fetch", "active");
      let authWasm!: Uint8Array;
      let channelWasm!: Uint8Array;
      await withSpan("deploy.fetch_wasms", traceId, async () => {
        authWasm = await fetchWasmFromRelease("channel_auth_contract", releaseVersion);
        channelWasm = await fetchWasmFromRelease("privacy_channel", releaseVersion);
      });
      setStep("step-fetch", "done");

      // 2. Install Channel Auth WASM
      setStep("step-install-auth", "active");
      let authWasmHash!: Uint8Array;
      await withSpan("deploy.install_channel_auth", traceId, async () => {
        const { xdr, wasmHash } = await buildInstallWasmTx(authWasm, adminAddress);
        authWasmHash = wasmHash;
        const signed = await signTransaction(xdr);
        await submitTx(signed);
      });
      setStep("step-install-auth", "done");

      // 3. Deploy Channel Auth
      setStep("step-deploy-auth", "active");
      let channelAuthId!: string;
      await withSpan("deploy.deploy_channel_auth", traceId, async () => {
        const adminScVal = nativeToScVal(Address.fromString(adminAddress), { type: "address" });
        const xdr = await buildDeployContractTx(authWasmHash, adminAddress, [adminScVal]);
        const signed = await signTransaction(xdr);
        const { contractId } = await submitTx(signed);
        if (!contractId) throw new Error("Failed to extract Channel Auth contract ID");
        channelAuthId = contractId;
      });
      setStep("step-deploy-auth", "done");

      // 4. Install Privacy Channel WASM
      setStep("step-install-channel", "active");
      let channelWasmHash!: Uint8Array;
      await withSpan("deploy.install_privacy_channel", traceId, async () => {
        const { xdr, wasmHash } = await buildInstallWasmTx(channelWasm, adminAddress);
        channelWasmHash = wasmHash;
        const signed = await signTransaction(xdr);
        await submitTx(signed);
      });
      setStep("step-install-channel", "done");

      // 5. Deploy Privacy Channel
      setStep("step-deploy-channel", "active");
      let privacyChannelId!: string;
      await withSpan("deploy.deploy_privacy_channel", traceId, async () => {
        const assetAddress = await getAssetContractId(assetCode, assetIssuer || undefined);
        const channelArgs = [
          nativeToScVal(Address.fromString(adminAddress), { type: "address" }),
          nativeToScVal(Address.fromString(channelAuthId), { type: "address" }),
          nativeToScVal(Address.fromString(assetAddress), { type: "address" }),
        ];
        const xdr = await buildDeployContractTx(channelWasmHash, adminAddress, channelArgs);
        const signed = await signTransaction(xdr);
        const { contractId } = await submitTx(signed);
        if (!contractId) throw new Error("Failed to extract Privacy Channel contract ID");
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
      });

      capture("council_deploy_complete", {
        channelAuthId,
        privacyChannelId,
        assetCode,
        adminAddress,
      });

      btn.hidden = true;
      resultEl.hidden = false;
      (el.querySelector("#result-auth-id") as HTMLElement).textContent = channelAuthId;
      (el.querySelector("#result-channel-id") as HTMLElement).textContent = privacyChannelId;

      el.querySelector("#goto-providers")?.addEventListener("click", () => {
        navigate(`/providers?council=${encodeURIComponent(channelAuthId)}`);
      });
    } catch (error) {
      capture("council_deploy_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      errorEl.textContent = error instanceof Error ? error.message : String(error);
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });

  return el;
}

export const deployView = page(renderContent);
