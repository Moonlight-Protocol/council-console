import { page } from "../components/page.ts";
import { escapeHtml, truncateAddress } from "../lib/dom.ts";
import { addCouncil, getCouncil } from "../lib/store.ts";
import { navigate } from "../lib/router.ts";
import { capture } from "../lib/analytics.ts";

async function queryCouncilOnChain(channelAuthId: string): Promise<{
  admin: string;
  providers: string[];
}> {
  const { buildInvokeContractTx, getRpcServer, sdk } = await import("../lib/stellar.ts");
  const stellar = await sdk();
  const server = await getRpcServer();

  // Query admin
  const { Contract, TransactionBuilder, Keypair } = stellar;
  const contract = new Contract(channelAuthId);

  // Use a throwaway keypair to build read-only queries (no signing needed)
  const throwaway = Keypair.random() as { publicKey(): string };
  const sourceKey = throwaway.publicKey();

  // Fund not needed for simulation-only queries
  const account = await server.getAccount(sourceKey).catch(() => null);
  if (!account) {
    // Account doesn't exist — for read-only we can still simulate
    // by using any valid account. Try the admin query via direct RPC.
    throw new Error("Could not query contract. Make sure the contract ID is valid and the network is reachable.");
  }

  const adminTx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: (await import("../lib/stellar.ts")).NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("admin"))
    .setTimeout(30)
    .build();

  const adminSim = await server.simulateTransaction(adminTx);
  if ("error" in adminSim && adminSim.error) {
    throw new Error(`Failed to query admin: ${adminSim.error}`);
  }

  // Extract admin address from simulation result
  const adminResult = (adminSim as { result?: { retval?: { address?(): { accountId?(): string } } } }).result;
  const adminAddress = adminResult?.retval?.address?.()?.accountId?.() ?? "";

  return { admin: adminAddress, providers: [] };
}

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Import Existing Council</h2>
      <a href="#/councils" class="btn-link">Back to Councils</a>
    </div>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Enter a Channel Auth contract ID to import an existing council.
      The console will query the contract on-chain to populate its details.
    </p>

    <div class="form-group">
      <label for="channel-auth-id">Channel Auth Contract ID</label>
      <input type="text" id="channel-auth-id" placeholder="C..." autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="asset-code">Asset Code</label>
      <input type="text" id="asset-code" value="XLM" placeholder="XLM" />
    </div>
    <div class="form-group">
      <label for="asset-issuer">Asset Issuer <span style="color:var(--text-muted)">(leave blank for native XLM)</span></label>
      <input type="text" id="asset-issuer" placeholder="G..." autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="privacy-channel-id">Privacy Channel Contract ID <span style="color:var(--text-muted)">(optional)</span></label>
      <input type="text" id="privacy-channel-id" placeholder="C..." autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="council-label">Label <span style="color:var(--text-muted)">(optional)</span></label>
      <input type="text" id="council-label" placeholder="e.g. Testnet Council" />
    </div>

    <button id="import-btn" class="btn-primary btn-wide">Import Council</button>
    <p id="import-status" class="hint-text" hidden></p>
    <p id="import-error" class="error-text" hidden></p>
  `;

  const importBtn = el.querySelector("#import-btn") as HTMLButtonElement;
  const statusEl = el.querySelector("#import-status") as HTMLParagraphElement;
  const errorEl = el.querySelector("#import-error") as HTMLParagraphElement;

  importBtn.addEventListener("click", async () => {
    const channelAuthId = (el.querySelector("#channel-auth-id") as HTMLInputElement).value.trim();
    const assetCode = (el.querySelector("#asset-code") as HTMLInputElement).value.trim() || "XLM";
    const assetIssuer = (el.querySelector("#asset-issuer") as HTMLInputElement).value.trim() || undefined;
    const privacyChannelId = (el.querySelector("#privacy-channel-id") as HTMLInputElement).value.trim() || undefined;
    const label = (el.querySelector("#council-label") as HTMLInputElement).value.trim() || undefined;

    if (!channelAuthId) {
      errorEl.textContent = "Channel Auth Contract ID is required";
      errorEl.hidden = false;
      return;
    }

    if (getCouncil(channelAuthId)) {
      errorEl.textContent = "This council is already imported";
      errorEl.hidden = false;
      return;
    }

    importBtn.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = "Importing council...";
    statusEl.hidden = false;

    try {
      const { getConnectedAddress } = await import("../lib/wallet.ts");
      const adminAddress = getConnectedAddress() ?? "";

      addCouncil({
        channelAuthId,
        privacyChannelId,
        assetCode,
        assetIssuer,
        adminAddress,
        providers: [],
        createdAt: new Date().toISOString(),
        label,
      });

      capture("council_imported", { channelAuthId });
      statusEl.textContent = "Council imported successfully!";

      setTimeout(() => navigate("/councils"), 1000);
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Import failed";
      errorEl.hidden = false;
      statusEl.hidden = true;
    } finally {
      importBtn.disabled = false;
    }
  });

  return el;
}

export const importView = page(renderContent);
