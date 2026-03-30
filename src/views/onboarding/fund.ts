import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { deriveOpExKeypair } from "../../lib/wallet.ts";
import { escapeHtml } from "../../lib/dom.ts";
import { STELLAR_NETWORK, FRIENDBOT_URL } from "../../lib/config.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <h2>Fund your council's treasury</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Your council needs a funded treasury (OpEx) account to cover network fees.
      This account is derived from your wallet — only you can recreate it.
    </p>

    <div id="deriving" style="color:var(--text-muted)">Deriving treasury account (1 signature)...</div>
    <div id="fund-content" hidden></div>
    <p id="fund-error" class="error-text" hidden></p>
  `;

  const derivingEl = el.querySelector("#deriving") as HTMLDivElement;
  const contentEl = el.querySelector("#fund-content") as HTMLDivElement;
  const errorEl = el.querySelector("#fund-error") as HTMLParagraphElement;

  // Derive OpEx keypair, then show the fund UI
  deriveOpExKeypair().then(({ publicKey, secretKey }) => {
    // Store public key for later steps (secret key stays in memory only)
    sessionStorage.setItem("onboarding_opex_pk", publicKey);

    derivingEl.hidden = true;
    contentEl.hidden = false;

    const showFriendbot = STELLAR_NETWORK === "testnet" || STELLAR_NETWORK === "standalone";

    contentEl.innerHTML = `
      <div class="stat-card" id="balance-card" style="margin-bottom:1.5rem">
        <span class="stat-label">Treasury Address</span>
        <span id="balance-value" class="stat-value" style="font-size:1.25rem;color:var(--text-muted)">Checking...</span>
        <span class="mono" style="font-size:0.7rem;color:var(--text-muted);margin-top:0.25rem">${escapeHtml(publicKey)}</span>
      </div>

      <div id="balance-warning" class="balance-warning" hidden>
        Your treasury balance is too low.
        ${showFriendbot
          ? `On this network you can fund it for free.
             <button id="fund-btn" class="btn-primary" style="margin-top:0.75rem">Fund via Friendbot</button>`
          : `Send at least 20 XLM to the address above.`}
      </div>

      <p id="fund-status" class="hint-text" hidden></p>

      <div style="display:flex;gap:0.75rem;margin-top:1.5rem">
        <button id="refresh-btn" class="btn-primary" style="background:var(--border);flex:none">Check Balance</button>
        <button id="next-btn" class="btn-primary btn-wide" disabled>Next</button>
      </div>
    `;

    const balanceEl = contentEl.querySelector("#balance-value") as HTMLElement;
    const cardEl = contentEl.querySelector("#balance-card") as HTMLDivElement;
    const warningEl = contentEl.querySelector("#balance-warning") as HTMLDivElement;
    const nextBtn = contentEl.querySelector("#next-btn") as HTMLButtonElement;
    const statusEl = contentEl.querySelector("#fund-status") as HTMLParagraphElement;

    async function checkBalance() {
      const { getAccountBalance } = await import("../../lib/stellar.ts");
      const { xlm, funded } = await getAccountBalance(publicKey);

      if (!funded) {
        balanceEl.textContent = "Not funded";
        balanceEl.style.color = "var(--inactive)";
        warningEl.hidden = false;
        nextBtn.disabled = true;
      } else {
        const balance = parseFloat(xlm);
        balanceEl.textContent = `${balance.toFixed(2)} XLM`;
        if (balance < 20) {
          balanceEl.style.color = "var(--pending)";
          cardEl.classList.add("pending");
          warningEl.hidden = false;
          nextBtn.disabled = true;
        } else {
          balanceEl.style.color = "var(--active)";
          cardEl.classList.add("active");
          warningEl.hidden = true;
          nextBtn.disabled = false;
        }
      }
    }

    checkBalance();

    contentEl.querySelector("#refresh-btn")?.addEventListener("click", () => {
      balanceEl.textContent = "Checking...";
      balanceEl.style.color = "var(--text-muted)";
      cardEl.className = "stat-card";
      checkBalance();
    });

    // Friendbot funding
    contentEl.querySelector("#fund-btn")?.addEventListener("click", async () => {
      const fundBtn = contentEl.querySelector("#fund-btn") as HTMLButtonElement;
      fundBtn.disabled = true;
      fundBtn.textContent = "Funding...";

      try {
        const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
        if (!res.ok && res.status !== 400) {
          throw new Error(`Friendbot error: ${res.status}`);
        }
        statusEl.textContent = "Account funded! Checking balance...";
        statusEl.hidden = false;
        await checkBalance();
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : String(err);
        errorEl.hidden = false;
        fundBtn.disabled = false;
        fundBtn.textContent = "Fund via Friendbot";
      }
    });

    nextBtn.addEventListener("click", () => {
      navigate("/create-council/create");
    });
  }).catch((err) => {
    derivingEl.hidden = true;
    errorEl.textContent = err instanceof Error ? err.message : "Failed to derive treasury account";
    errorEl.hidden = false;
  });

  return el;
}

export const fundView = onboardingPage("fund", renderStep);
