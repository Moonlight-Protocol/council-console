import { page } from "../components/page.ts";
import { escapeHtml, renderError, truncateAddress } from "../lib/dom.ts";
import { getConnectedAddress } from "../lib/wallet.ts";
import { capture } from "../lib/analytics.ts";
import { startTrace, withSpan } from "../lib/tracer.ts";
import { navigate } from "../lib/router.ts";

async function isValidStellarAddress(address: string): Promise<boolean> {
  const stellar = await import("../lib/stellar.ts");
  const { StrKey } = await stellar.sdk();
  return StrKey.isValidEd25519PublicKey(address);
}

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  const params = new URLSearchParams(
    globalThis.location.hash.split("?")[1] || "",
  );
  const councilId = params.get("council");

  if (!councilId) {
    const councils = loadCouncils();
    if (councils.length === 0) {
      el.innerHTML = `
        <h2>Manage Providers</h2>
        <div class="empty-state">
          <p>No councils found. Deploy a council first.</p>
          <a href="#/deploy" class="btn-primary" style="display:inline-block;margin-top:0.5rem">Deploy Council</a>
        </div>
      `;
      return el;
    }

    el.innerHTML = `
      <h2>Manage Providers</h2>
      <p style="color:var(--text-muted);margin-bottom:1rem">Select a council to manage its providers.</p>
      <table>
        <thead><tr><th>Label</th><th>Channel Auth</th><th>Providers</th><th></th></tr></thead>
        <tbody>${
      councils.map((council) => `
          <tr>
            <td>${escapeHtml(council.label || "Unnamed")}</td>
            <td class="mono">${truncateAddress(council.channelAuthId)}</td>
            <td>${council.providers.length}</td>
            <td><a href="#/providers?council=${
        encodeURIComponent(council.channelAuthId)
      }" class="btn-link">Manage</a></td>
          </tr>
        `).join("")
    }</tbody>
      </table>
    `;
    return el;
  }

  const council = getCouncil(councilId);
  if (!council) {
    renderError(el, "Council Not Found", `No local record for ${councilId}`);
    return el;
  }

  const providerRows = council.providers.length > 0
    ? council.providers.map((p) => `
        <tr>
          <td class="mono">${escapeHtml(p)}</td>
          <td>
            <button class="btn-link remove-provider" data-address="${
      escapeHtml(p)
    }" style="color:var(--inactive)">Remove</button>
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="2" style="color:var(--text-muted)">No providers registered</td></tr>`;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Providers for ${
    escapeHtml(council.label || truncateAddress(councilId))
  }</h2>
      <a href="#/" class="btn-link">Back to Councils</a>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Channel Auth</span>
        <span class="stat-value mono" style="font-size:0.7rem">${
    escapeHtml(councilId)
  }</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Registered Providers</span>
        <span class="stat-value">${council.providers.length}</span>
      </div>
    </div>

    <h3>Add Provider</h3>
    <div class="form-row" style="margin-bottom:1.5rem">
      <div class="form-group">
        <label>Provider Stellar Address</label>
        <input type="text" id="provider-address" placeholder="G..." />
      </div>
      <button id="add-provider-btn" class="btn-primary" style="margin-bottom:1rem">Add On-Chain</button>
      <button id="import-provider-btn" class="btn-primary" style="margin-bottom:1rem;background:var(--border)">Import Existing</button>
    </div>
    <p id="provider-status" class="hint-text" hidden></p>
    <p id="provider-error" class="error-text" hidden></p>

    <h3>Registered Providers</h3>
    <table>
      <thead><tr><th>Address</th><th></th></tr></thead>
      <tbody>${providerRows}</tbody>
    </table>
  `;

  const statusEl = el.querySelector("#provider-status") as HTMLParagraphElement;
  const errorEl = el.querySelector("#provider-error") as HTMLParagraphElement;

  async function executeProviderAction(
    action: "add_provider" | "remove_provider",
    providerAddress: string,
  ) {
    const adminAddress = getConnectedAddress();
    if (!adminAddress) {
      errorEl.textContent = "Connect your wallet first";
      errorEl.hidden = false;
      return;
    }

    errorEl.hidden = true;
    statusEl.hidden = false;
    const actionLabel = action === "add_provider" ? "Adding" : "Removing";
    statusEl.textContent = `${actionLabel} provider ${
      truncateAddress(providerAddress)
    }...`;

    const { traceId } = startTrace();

    try {
      await withSpan(
        `provider.${action}`,
        traceId,
        async () => {
          const { buildInvokeContractTx, submitTx, sdk: getSdk } = await import(
            "../lib/stellar.ts"
          );
          const { nativeToScVal, Address } = await getSdk();
          const { signTransaction } = await import("../lib/wallet.ts");

          const txXdr = await buildInvokeContractTx(
            councilId,
            action,
            [nativeToScVal(Address.fromString(providerAddress), {
              type: "address",
            })],
            adminAddress,
          );

          statusEl.textContent =
            "Please approve the transaction in your wallet...";
          const signedXdr = await signTransaction(txXdr);

          statusEl.textContent = "Submitting transaction...";
          await submitTx(signedXdr);
        },
        undefined,
        {
          "provider.address": providerAddress,
          "channel_auth.id": councilId,
        },
      );

      if (action === "add_provider") {
        updateCouncil(councilId, {
          providers: [...council.providers, providerAddress],
        });
      } else {
        updateCouncil(councilId, {
          providers: council.providers.filter((p) => p !== providerAddress),
        });
      }

      capture(`council_${action}`, {
        providerAddress,
        channelAuthId: councilId,
      });
      statusEl.textContent = `Provider ${truncateAddress(providerAddress)} ${
        action === "add_provider" ? "added" : "removed"
      }`;

      setTimeout(() => {
        navigate(`/providers?council=${encodeURIComponent(councilId)}`, {
          force: true,
        });
      }, 1500);
    } catch (error) {
      capture(`council_${action}_failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      errorEl.textContent = error instanceof Error
        ? error.message
        : String(error);
      errorEl.hidden = false;
      statusEl.hidden = true;
    }
  }

  el.querySelector("#add-provider-btn")?.addEventListener("click", async () => {
    const addressInput = el.querySelector(
      "#provider-address",
    ) as HTMLInputElement;
    const providerAddress = addressInput.value.trim();
    if (!providerAddress) {
      errorEl.textContent = "Provider address is required";
      errorEl.hidden = false;
      return;
    }
    if (!(await isValidStellarAddress(providerAddress))) {
      errorEl.textContent = "Invalid Stellar address";
      errorEl.hidden = false;
      return;
    }
    executeProviderAction("add_provider", providerAddress);
  });

  // Import existing provider (add to local record without on-chain call)
  el.querySelector("#import-provider-btn")?.addEventListener(
    "click",
    async () => {
      const addressInput = el.querySelector(
        "#provider-address",
      ) as HTMLInputElement;
      const providerAddress = addressInput.value.trim();
      if (!providerAddress) {
        errorEl.textContent = "Provider address is required";
        errorEl.hidden = false;
        return;
      }
      if (!(await isValidStellarAddress(providerAddress))) {
        errorEl.textContent = "Invalid Stellar address";
        errorEl.hidden = false;
        return;
      }
      if (council.providers.includes(providerAddress)) {
        errorEl.textContent = "Provider already in local record";
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      updateCouncil(councilId, {
        providers: [...council.providers, providerAddress],
      });
      capture("council_import_provider", {
        providerAddress,
        channelAuthId: councilId,
      });
      statusEl.textContent = `Provider ${
        truncateAddress(providerAddress)
      } added to local record`;
      statusEl.hidden = false;
      setTimeout(
        () =>
          navigate(`/providers?council=${encodeURIComponent(councilId)}`, {
            force: true,
          }),
        1000,
      );
    },
  );

  el.querySelectorAll(".remove-provider").forEach((btn) => {
    btn.addEventListener("click", () => {
      const address = (btn as HTMLElement).dataset.address;
      if (!address) return;
      if (!confirm(`Remove provider ${truncateAddress(address)}?`)) return;
      executeProviderAction("remove_provider", address);
    });
  });

  return el;
}

export const providersView = page(renderContent);
