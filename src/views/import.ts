import { page } from "../components/page.ts";
import { addCouncil, getCouncil } from "../lib/store.ts";
import { navigate } from "../lib/router.ts";
import { capture } from "../lib/analytics.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Import Existing Council</h2>
      <a href="#/" class="btn-link">Back to Councils</a>
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
      <label for="known-providers">Known Providers <span style="color:var(--text-muted)">(one address per line, optional)</span></label>
      <textarea id="known-providers" rows="3" placeholder="GABC...&#10;GDEF..."></textarea>
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
    const channelAuthId =
      (el.querySelector("#channel-auth-id") as HTMLInputElement).value.trim();
    const assetCode =
      (el.querySelector("#asset-code") as HTMLInputElement).value.trim() ||
      "XLM";
    const assetIssuer =
      (el.querySelector("#asset-issuer") as HTMLInputElement).value.trim() ||
      undefined;
    const privacyChannelId =
      (el.querySelector("#privacy-channel-id") as HTMLInputElement).value
        .trim() || undefined;
    const providersRaw =
      (el.querySelector("#known-providers") as HTMLTextAreaElement).value
        .trim();
    const providers = providersRaw
      ? providersRaw.split("\n").map((l) => l.trim()).filter((l) =>
        l.length > 0
      )
      : [];
    const label =
      (el.querySelector("#council-label") as HTMLInputElement).value.trim() ||
      undefined;

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
        providers,
        createdAt: new Date().toISOString(),
        label,
      });

      capture("council_imported", { channelAuthId });
      statusEl.textContent = "Council imported successfully!";

      setTimeout(() => navigate("/"), 1000);
    } catch (error) {
      errorEl.textContent = error instanceof Error
        ? error.message
        : "Import failed";
      errorEl.hidden = false;
      statusEl.hidden = true;
    } finally {
      importBtn.disabled = false;
    }
  });

  return el;
}

export const importView = page(renderContent);
