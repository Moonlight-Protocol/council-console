import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { getConnectedAddress } from "../../lib/wallet.ts";
import { isPlatformConfigured, isAuthenticated as isPlatformAuthed, registerChannel } from "../../lib/platform.ts";
import { capture } from "../../lib/analytics.ts";
import { startTrace, withSpan } from "../../lib/tracer.ts";
import { friendlyError } from "../../lib/dom.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");

  const councilId = sessionStorage.getItem("onboarding_council_id");

  if (!councilId) {
    navigate("/create-council/metadata");
    return el;
  }

  el.innerHTML = `
    <h2>Enable assets</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Your council supports <strong>XLM</strong> by default.
      Add additional assets below, or continue to finish setup.
      Each asset requires <strong>2 wallet signatures</strong>.
    </p>

    <div id="asset-list" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem">
      <span class="asset-badge" style="opacity:0.5">XLM</span>
    </div>

    <div class="form-row" style="margin-bottom:0.5rem">
      <div class="form-group">
        <label>Asset Code</label>
        <input type="text" id="asset-code" placeholder="e.g. USDC" />
      </div>
      <div class="form-group">
        <label>Asset Issuer</label>
        <input type="text" id="asset-issuer" placeholder="G..." />
      </div>
    </div>

    <div id="deploy-progress" hidden>
      <div id="asset-deploy-steps"></div>
    </div>
    <p id="asset-error" class="error-text" hidden></p>

    <div style="display:flex;gap:0.75rem;margin-top:1rem">
      <button id="add-btn" class="btn-primary">Add Asset</button>
      <button id="continue-btn" class="btn-primary" style="background:var(--border)">Continue</button>
    </div>
  `;

  const addBtn = el.querySelector("#add-btn") as HTMLButtonElement;
  const continueBtn = el.querySelector("#continue-btn") as HTMLButtonElement;
  const progressEl = el.querySelector("#deploy-progress") as HTMLDivElement;
  const stepsEl = el.querySelector("#asset-deploy-steps") as HTMLDivElement;
  const assetErrorEl = el.querySelector("#asset-error") as HTMLParagraphElement;

  continueBtn.addEventListener("click", () => navigate("/create-council/invite"));

  addBtn.addEventListener("click", async () => {
    const assetCode = (el.querySelector("#asset-code") as HTMLInputElement).value.trim();
    const assetIssuer = (el.querySelector("#asset-issuer") as HTMLInputElement).value.trim();

    if (!assetCode) {
      assetErrorEl.textContent = "Asset code is required";
      assetErrorEl.hidden = false;
      return;
    }

    if (!assetIssuer) {
      assetErrorEl.textContent = "Asset issuer is required (G... address)";
      assetErrorEl.hidden = false;
      return;
    }

    const adminAddress = getConnectedAddress();
    if (!adminAddress) return;

    addBtn.disabled = true;
    continueBtn.hidden = true;
    assetErrorEl.hidden = true;
    // Clear previous failed steps
    stepsEl.querySelectorAll(".deploy-step-error").forEach((s) => s.remove());
    progressEl.hidden = false;

    const stepEl = document.createElement("div");
    stepEl.className = "deploy-step deploy-step-active";
    stepEl.textContent = `Enabling ${assetCode} (1/2)...`;
    stepsEl.appendChild(stepEl);

    const { traceId } = startTrace();

    try {
      const {
        fetchWasm,
        buildInstallWasmTx,
        buildDeployContractTx,
        computeDeploySalt,
        submitTx,
        getAssetContractId,
        sdk: getSdk,
      } = await import("../../lib/stellar.ts");
      const { nativeToScVal, Address } = await getSdk();
      const { signTransaction } = await import("../../lib/wallet.ts");

      let channelId!: string;
      let assetContractId!: string;

      await withSpan(`asset.enable_${assetCode}`, traceId, async () => {
        const wasm = await fetchWasm("privacy_channel");
        const { xdr: installXdr, wasmHash } = await buildInstallWasmTx(wasm, adminAddress);
        const installSigned = await signTransaction(installXdr);
        await submitTx(installSigned);

        stepEl.textContent = `Enabling ${assetCode} (2/2)...`;

        assetContractId = await getAssetContractId(assetCode, assetIssuer);
        const args = [
          nativeToScVal(Address.fromString(adminAddress), { type: "address" }),
          nativeToScVal(Address.fromString(councilId), { type: "address" }),
          nativeToScVal(Address.fromString(assetContractId), { type: "address" }),
        ];
        const assetSalt = await computeDeploySalt(councilId, assetCode, assetIssuer);
        const deployXdr = await buildDeployContractTx(wasmHash, adminAddress, args, assetSalt);
        const deploySigned = await signTransaction(deployXdr);
        const { contractId } = await submitTx(deploySigned);
        if (!contractId) throw new Error(`Failed to deploy ${assetCode} channel`);
        channelId = contractId;
      });

      // Register with platform
      if (isPlatformConfigured() && isPlatformAuthed()) {
        try {
          await registerChannel({
            channelContractId: channelId,
            assetCode,
            assetContractId,
            issuerAddress: assetIssuer,
            label: `${assetCode} Privacy Channel`,
          });
        } catch (err) {
          console.warn("Platform channel registration failed:", err);
          stepEl.className = "deploy-step deploy-step-error";
          stepEl.textContent = `${assetCode} deployed but platform registration failed`;
        }
      }

      stepEl.className = "deploy-step deploy-step-done";
      stepEl.textContent = `${assetCode} enabled`;
      capture("council_asset_enabled", { assetCode, channelId });

      // Show the new asset as a badge
      const assetList = el.querySelector("#asset-list") as HTMLDivElement;
      const badge = document.createElement("span");
      badge.className = "asset-badge";
      badge.textContent = assetCode;
      assetList.appendChild(badge);

      // Reset form for another asset
      (el.querySelector("#asset-code") as HTMLInputElement).value = "";
      (el.querySelector("#asset-issuer") as HTMLInputElement).value = "";
      addBtn.disabled = false;
      continueBtn.hidden = false;
    } catch (err) {
      stepEl.className = "deploy-step deploy-step-error";
      stepEl.textContent = `${assetCode} failed`;
      assetErrorEl.textContent = friendlyError(err);
      assetErrorEl.hidden = false;
      addBtn.disabled = false;
      continueBtn.hidden = false;
    }
  });

  return el;
}

export const assetsView = onboardingPage("assets", renderStep);
