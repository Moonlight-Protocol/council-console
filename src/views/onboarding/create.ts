import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { getConnectedAddress } from "../../lib/wallet.ts";
import { getFormDraft, clearFormDraft } from "../../lib/onboarding.ts";
import { COUNTRY_CODES } from "../../lib/jurisdictions.ts";
import { escapeHtml, friendlyError } from "../../lib/dom.ts";
import { capture } from "../../lib/analytics.ts";
import { startTrace, withSpan } from "../../lib/tracer.ts";
import {
  isPlatformConfigured,
  isAuthenticated as isPlatformAuthed,
  pushMetadata,
  addJurisdiction,
  registerChannel,
  listCouncils,
} from "../../lib/platform.ts";

const PROGRESS_KEY = "council_create_progress";

interface CreateProgress {
  adminAddress?: string;       // wallet that started this deployment
  authWasmHash?: string;       // hex-encoded
  channelAuthId?: string;
  channelWasmHash?: string;    // hex-encoded
  privacyChannelId?: string;
  assetContractId?: string;
  councilIndex?: number;        // derivation index used for this council
  step: number;                // 0-4 (0 = not started, 4 = done)
}

// Use localStorage (not sessionStorage) so progress survives tab close.
// This prevents orphaned on-chain contracts if the user closes mid-deploy:
// they can reopen the page and resume from the last completed step.
function loadProgress(): CreateProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : { step: 0 };
  } catch {
    return { step: 0 };
  }
}

function saveProgress(p: CreateProgress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
}

function clearProgress() {
  localStorage.removeItem(PROGRESS_KEY);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const STEPS = [
  { id: "create-council", label: "Creating council" },
  { id: "enable-xlm", label: "Enabling XLM" },
];

function renderStep(): HTMLElement {
  const el = document.createElement("div");

  const metadata = getFormDraft("metadata") as {
    name?: string; description?: string; contactEmail?: string; jurisdictions?: string[];
  } | null;

  const progress = loadProgress();

  const stepsHtml = STEPS.map((s, i) => {
    let cls = "deploy-step";
    if (i < progress.step) cls += " deploy-step-done";
    return `<div id="cs-${s.id}" class="${cls}">${s.label}</div>`;
  }).join("");

  el.innerHTML = `
    <h2>Council</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      This will set up your Council. We need you to approve <strong>4 transactions</strong> (2 per step).
    </p>

    ${metadata?.name ? `
      <div class="stat-card" style="margin-bottom:1.5rem">
        <span class="stat-label">Council</span>
        <span class="stat-value" style="font-size:1.1rem">${escapeHtml(metadata.name)}</span>
      </div>
    ` : ''}

    <div id="create-steps" style="margin-bottom:1rem">${stepsHtml}</div>

    <p id="create-error" class="error-text" hidden></p>

    <button id="create-btn" class="btn-primary btn-wide" style="margin-top:1rem">
      ${progress.step > 0 && progress.step < 4 ? "Resume" : "Create Council"}
    </button>
  `;

  const createBtn = el.querySelector("#create-btn") as HTMLButtonElement;
  const errorEl = el.querySelector("#create-error") as HTMLParagraphElement;

  function markStep(idx: number, status: "active" | "done" | "error", sub?: string) {
    const stepEl = el.querySelector(`#cs-${STEPS[idx].id}`) as HTMLDivElement;
    if (!stepEl) return;
    stepEl.className = `deploy-step deploy-step-${status}`;
    if (sub) stepEl.textContent = `${STEPS[idx].label} (${sub})`;
  }

  createBtn.addEventListener("click", async () => {
    const adminAddress = getConnectedAddress();
    if (!adminAddress) {
      errorEl.textContent = "Wallet not connected";
      errorEl.hidden = false;
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = "Creating...";
    errorEl.hidden = true;

    const p = loadProgress();

    // Prevent a different wallet from resuming another user's deployment
    if (p.step > 0 && p.adminAddress && p.adminAddress !== adminAddress) {
      clearProgress();
      errorEl.textContent = "Previous deployment was started by a different wallet. Starting fresh.";
      errorEl.hidden = false;
      createBtn.disabled = false;
      createBtn.textContent = "Create Council";
      return;
    }
    p.adminAddress = adminAddress;
    saveProgress(p);

    const { traceId } = startTrace();

    try {
      const {
        fetchWasm,
        buildInstallWasmTx,
        buildDeployContractTx,
        computeDeploySalt,
        submitTx,
        ensureSacDeployed,
        sdk: getSdk,
      } = await import("../../lib/stellar.ts");
      const { nativeToScVal, Address } = await getSdk();
      const { signTransaction } = await import("../../lib/wallet.ts");

      // Step 0: Install Channel Auth WASM
      if (p.step < 1) {
        markStep(0, "active", "1/2");
        await withSpan("create.install_auth", traceId, async () => {
          const authWasm = await fetchWasm("channel_auth_contract");
          const { xdr: installXdr, wasmHash } = await buildInstallWasmTx(authWasm, adminAddress);
          const installSigned = await signTransaction(installXdr);
          await submitTx(installSigned);
          p.authWasmHash = bytesToHex(wasmHash);
          p.step = 1;
          saveProgress(p);
        });
        markStep(0, "active", "2/2");
      }

      // Step 1: Deploy Channel Auth
      if (p.step < 2) {
        await withSpan("create.deploy_auth", traceId, async () => {
          const adminScVal = nativeToScVal(Address.fromString(adminAddress), { type: "address" });
          // Find the next available council index by scanning DB + on-chain
          const { computeCouncilSalt, deriveContractAddress, sdk: getSdk, getRpcServer } = await import("../../lib/stellar.ts");
          const { getNetworkPassphrase } = await import("../../lib/config.ts");
          const stellar = await getSdk();
          const server = await getRpcServer();

          const usedAddresses = new Set<string>();
          if (isPlatformConfigured() && isPlatformAuthed()) {
            try {
              const active = await listCouncils();
              for (const c of active) usedAddresses.add(c.councilId);
            } catch { /* platform unavailable */ }
          }

          // Sequential RPC calls to find the first unused derivation index.
          // Up to MAX_SCAN calls is acceptable here — this only runs once during
          // onboarding, not on every page load.
          let councilIndex = 0;
          const MAX_SCAN = 20;
          for (; councilIndex < MAX_SCAN; councilIndex++) {
            const testSalt = await computeCouncilSalt(adminAddress, councilIndex);
            const testAddr = await deriveContractAddress(adminAddress, testSalt);
            if (usedAddresses.has(testAddr)) continue;
            // Check on-chain — try to call admin() on the derived address
            try {
              const contract = new stellar.Contract(testAddr);
              const account = await server.getAccount(adminAddress);
              const tx = new stellar.TransactionBuilder(account, { fee: "100", networkPassphrase: getNetworkPassphrase() })
                .addOperation(contract.call("admin"))
                .setTimeout(30)
                .build();
              const sim = await server.simulateTransaction(tx);
              if (!("error" in sim && sim.error)) continue; // contract exists, skip
            } catch { /* not found — available */ }
            break;
          }
          const councilSalt = await computeCouncilSalt(adminAddress, councilIndex);
          const deployXdr = await buildDeployContractTx(hexToBytes(p.authWasmHash!), adminAddress, [adminScVal], councilSalt);
          const deploySigned = await signTransaction(deployXdr);
          const { contractId } = await submitTx(deploySigned);
          if (!contractId) throw new Error("Failed to create council");
          p.channelAuthId = contractId;
          p.councilIndex = councilIndex;
          p.step = 2;
          saveProgress(p);
        });
        markStep(0, "done");
      }

      // Step 2: Install Privacy Channel WASM
      if (p.step < 3) {
        markStep(1, "active", "1/2");
        await withSpan("create.install_channel", traceId, async () => {
          const channelWasm = await fetchWasm("privacy_channel");
          const { xdr: installXdr, wasmHash } = await buildInstallWasmTx(channelWasm, adminAddress);
          const installSigned = await signTransaction(installXdr);
          await submitTx(installSigned);
          p.channelWasmHash = bytesToHex(wasmHash);
          p.step = 3;
          saveProgress(p);
        });
        markStep(1, "active", "2/2");
      }

      // Step 3: Deploy Privacy Channel
      if (p.step < 4) {
        await withSpan("create.deploy_channel", traceId, async () => {
          p.assetContractId = await ensureSacDeployed("XLM", undefined, adminAddress, signTransaction);
          const channelArgs = [
            nativeToScVal(Address.fromString(adminAddress), { type: "address" }),
            nativeToScVal(Address.fromString(p.channelAuthId!), { type: "address" }),
            nativeToScVal(Address.fromString(p.assetContractId!), { type: "address" }),
          ];
          const xlmSalt = await computeDeploySalt(p.channelAuthId!, "XLM");
          const deployXdr = await buildDeployContractTx(hexToBytes(p.channelWasmHash!), adminAddress, channelArgs, xlmSalt);
          const deploySigned = await signTransaction(deployXdr);
          const { contractId } = await submitTx(deploySigned);
          if (!contractId) throw new Error("Failed to create privacy channel");
          p.privacyChannelId = contractId;
          p.step = 4;
          saveProgress(p);
        });
        markStep(1, "done");
      }

      // Store the council ID and index so subsequent onboarding steps can find the right council
      sessionStorage.setItem("onboarding_council_id", p.channelAuthId!);
      sessionStorage.setItem("onboarding_council_index", String(p.councilIndex ?? 0));

      // Push metadata, jurisdictions, and XLM channel to platform (uses existing JWT from login)
      if (isPlatformConfigured() && isPlatformAuthed()) {
        try {
          if (metadata?.name) {
            await pushMetadata({
              councilId: p.channelAuthId!,
              name: metadata.name,
              description: metadata.description || undefined,
              contactEmail: metadata.contactEmail || undefined,
            });
          }
          if (metadata?.jurisdictions) {
            for (const code of metadata.jurisdictions) {
              const entry = COUNTRY_CODES.find((c: { code: string }) => c.code === code);
              await addJurisdiction(p.channelAuthId!, code, entry?.label);
            }
          }
          await registerChannel(p.channelAuthId!, {
            channelContractId: p.privacyChannelId!,
            assetCode: "XLM",
            assetContractId: p.assetContractId!,
            issuerAddress: "",
            label: "XLM Privacy Channel",
          });
        } catch (err) {
          console.warn("Platform registration failed:", err);
        }
      }

      // Don't clear metadata draft yet — the fund step needs it for the name
      capture("council_created", { channelAuthId: p.channelAuthId, privacyChannelId: p.privacyChannelId });
      clearProgress();

      createBtn.hidden = true;
      setTimeout(() => navigate("/create-council/fund"), 1000);
    } catch (error) {
      const msg = friendlyError(error);
      capture("council_create_failed", { error: msg });
      if (p.step < 4) markStep(p.step < 2 ? 0 : 1, "error");
      errorEl.textContent = msg;
      errorEl.hidden = false;
      createBtn.disabled = false;
      createBtn.textContent = "Retry";
    }
  });

  return el;
}

export const createView = onboardingPage("create", renderStep);
