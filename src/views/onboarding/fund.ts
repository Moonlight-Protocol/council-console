import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { deriveOpExKeypair, getConnectedAddress } from "../../lib/wallet.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");
  const councilId = sessionStorage.getItem("onboarding_council_id") || "";

  el.innerHTML = `
    <h2>Treasury</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Your council needs a treasury account to cover operational fees on the network.
    </p>

    <div id="treasury-loading">
      <p style="color:var(--text-muted)">Deriving treasury account...</p>
    </div>

    <div id="treasury-content" hidden>
      <div class="stat-card" id="treasury-card" style="margin-bottom:1.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="stat-label">Treasury</span>
          <div style="display:flex;gap:0.25rem">
            <button class="icon-btn copy-treasury" title="Copy address"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            <button class="icon-btn refresh-balance" title="Refresh balance"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          </div>
        </div>
        <div id="treasury-address" style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;word-break:break-all"></div>
        <span id="treasury-balance" class="stat-value" style="font-size:1.25rem;display:block;margin-top:0.5rem">0.00 XLM</span>
      </div>

      <div class="stat-card" id="fund-card" style="margin-bottom:1.5rem">
        <span class="stat-label">Fund the treasury to operate</span>
        <div style="display:flex;gap:0.5rem;align-items:flex-end;margin-top:0.75rem">
          <div class="form-group" style="margin:0;flex:none;width:200px">
            <label for="fund-amount" style="white-space:nowrap">Suggested Amount (XLM)</label>
            <input type="number" id="fund-amount" value="10" min="1" step="1" />
          </div>
          <button id="fund-btn" class="btn-primary" style="padding:0.6rem 1.5rem">Fund Treasury</button>
        </div>
      </div>
    </div>

    <p id="fund-error" class="error-text" hidden></p>

    <div style="margin-top:1.5rem">
      <button id="next-btn" class="btn-primary btn-wide" disabled>Next</button>
    </div>
  `;

  const loadingEl = el.querySelector("#treasury-loading") as HTMLDivElement;
  const contentEl = el.querySelector("#treasury-content") as HTMLDivElement;
  const treasuryCard = el.querySelector("#treasury-card") as HTMLDivElement;
  const fundCard = el.querySelector("#fund-card") as HTMLDivElement;
  const addressEl = el.querySelector("#treasury-address") as HTMLDivElement;
  const balanceEl = el.querySelector("#treasury-balance") as HTMLSpanElement;
  const nextBtn = el.querySelector("#next-btn") as HTMLButtonElement;
  const errorEl = el.querySelector("#fund-error") as HTMLParagraphElement;

  let opexPublicKey = sessionStorage.getItem("onboarding_opex_pk") || "";

  async function checkBalance() {
    if (!opexPublicKey) return;
    const { getAccountBalance } = await import("../../lib/stellar.ts");
    const { xlm, funded } = await getAccountBalance(opexPublicKey);
    const balance = funded ? parseFloat(xlm) : 0;

    balanceEl.textContent = `${balance.toFixed(2)} XLM`;

    if (balance > 0) {
      balanceEl.style.color = "var(--active)";
      treasuryCard.className = "stat-card active";
      fundCard.hidden = true;
      nextBtn.disabled = false;
    } else {
      balanceEl.style.color = "var(--text-muted)";
      treasuryCard.className = "stat-card";
      fundCard.hidden = false;
      nextBtn.disabled = true;
    }
  }

  function showTreasuryInfo() {
    loadingEl.hidden = true;
    contentEl.hidden = false;
    addressEl.textContent = opexPublicKey;
    checkBalance();
  }

  // Auto-derive on load
  if (opexPublicKey) {
    showTreasuryInfo();
  } else {
    (async () => {
      try {
        const councilIndex = parseInt(
          sessionStorage.getItem("onboarding_council_index") || "0",
          10,
        );
        const { publicKey } = await deriveOpExKeypair(councilIndex);
        opexPublicKey = publicKey;
        sessionStorage.setItem("onboarding_opex_pk", publicKey);
        showTreasuryInfo();
      } catch (err) {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        errorEl.textContent = err instanceof Error
          ? err.message
          : "Failed to derive treasury account";
      }
    })();
  }

  // Copy address
  el.querySelector(".copy-treasury")?.addEventListener("click", () => {
    if (!opexPublicKey) return;
    navigator.clipboard.writeText(opexPublicKey).then(() => {
      const btn = el.querySelector(".copy-treasury") as HTMLButtonElement;
      const orig = btn.innerHTML;
      btn.innerHTML =
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
      setTimeout(() => {
        btn.innerHTML = orig;
      }, 1500);
    });
  });

  // Refresh balance
  el.querySelector(".refresh-balance")?.addEventListener(
    "click",
    () => checkBalance(),
  );

  // Fund treasury
  el.querySelector("#fund-btn")?.addEventListener("click", async () => {
    const fundBtn = el.querySelector("#fund-btn") as HTMLButtonElement;
    const amountInput = el.querySelector("#fund-amount") as HTMLInputElement;
    const amount = amountInput.value.trim();

    if (!amount || parseFloat(amount) <= 0) {
      errorEl.textContent = "Enter a valid amount";
      errorEl.hidden = false;
      return;
    }

    fundBtn.disabled = true;
    fundBtn.textContent = "Building transaction...";
    errorEl.hidden = true;

    try {
      const adminAddress = getConnectedAddress();
      if (!adminAddress) throw new Error("Wallet not connected");

      const { buildFundTreasuryTx, submitHorizonTx } = await import(
        "../../lib/stellar.ts"
      );
      const { signTransaction } = await import("../../lib/wallet.ts");

      const txXdr = await buildFundTreasuryTx(
        adminAddress,
        opexPublicKey,
        amount,
      );
      fundBtn.textContent = "Sign in wallet...";
      const signedXdr = await signTransaction(txXdr);
      fundBtn.textContent = "Submitting...";
      await submitHorizonTx(signedXdr);

      fundBtn.textContent = "Funded!";
      await checkBalance();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorEl.textContent = msg.includes("not found") || msg.includes("404")
        ? "Could not build transaction. Make sure your wallet has funds."
        : msg;
      errorEl.hidden = false;
      fundBtn.textContent = "Fund Treasury";
      fundBtn.disabled = false;
    }
  });

  nextBtn.addEventListener("click", async () => {
    nextBtn.disabled = true;
    nextBtn.textContent = "Saving...";
    try {
      const {
        pushMetadata,
        isPlatformConfigured,
        isAuthenticated: isPlatformAuthed,
      } = await import("../../lib/platform.ts");
      const { getFormDraft, clearFormDraft } = await import(
        "../../lib/onboarding.ts"
      );
      if (
        isPlatformConfigured() && isPlatformAuthed() && councilId &&
        opexPublicKey
      ) {
        const metadata = getFormDraft("metadata") as { name?: string } | null;
        await pushMetadata({
          councilId,
          name: metadata?.name || "Council",
          opexPublicKey,
        });
        clearFormDraft("metadata");
      }
      navigate("/create-council/assets");
    } catch (err) {
      errorEl.textContent = err instanceof Error
        ? err.message
        : "Failed to save treasury";
      errorEl.hidden = false;
      nextBtn.disabled = false;
      nextBtn.textContent = "Next";
    }
  });

  return el;
}

export const fundView = onboardingPage("fund", renderStep);
