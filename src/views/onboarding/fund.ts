import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { getConnectedAddress } from "../../lib/wallet.ts";
import { escapeHtml } from "../../lib/dom.ts";
import { STELLAR_NETWORK, FRIENDBOT_URL } from "../../lib/config.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");
  const adminAddress = getConnectedAddress() || "";

  const showFriendbot = STELLAR_NETWORK === "testnet" || STELLAR_NETWORK === "standalone";

  el.innerHTML = `
    <h2>Fund your account</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Creating a council requires deploying smart contracts to the Stellar network.
      Your account needs at least <strong>20 XLM</strong> to cover the deployment fees.
    </p>

    <div class="stat-card" id="balance-card" style="margin-bottom:1.5rem">
      <span class="stat-label">Your Balance</span>
      <span id="balance-value" class="stat-value" style="font-size:1.25rem;color:var(--text-muted)">Checking...</span>
      <span class="mono" style="font-size:0.7rem;color:var(--text-muted);margin-top:0.25rem">${escapeHtml(adminAddress)}</span>
    </div>

    <div id="balance-warning" class="balance-warning" hidden>
      Your balance is too low.
      ${showFriendbot
        ? `On this network you can fund your account for free.
           <button id="fund-btn" class="btn-primary" style="margin-top:0.75rem">Fund via Friendbot</button>`
        : `Send at least 20 XLM to the address above.`}
    </div>

    <p id="fund-error" class="error-text" hidden></p>
    <p id="fund-status" class="hint-text" hidden></p>

    <div style="display:flex;gap:0.75rem;margin-top:1.5rem">
      <button id="refresh-btn" class="btn-primary" style="background:var(--border);flex:none">Check Balance</button>
      <button id="next-btn" class="btn-primary btn-wide" disabled>Next</button>
    </div>
  `;

  const balanceEl = el.querySelector("#balance-value") as HTMLElement;
  const cardEl = el.querySelector("#balance-card") as HTMLDivElement;
  const warningEl = el.querySelector("#balance-warning") as HTMLDivElement;
  const nextBtn = el.querySelector("#next-btn") as HTMLButtonElement;
  const errorEl = el.querySelector("#fund-error") as HTMLParagraphElement;
  const statusEl = el.querySelector("#fund-status") as HTMLParagraphElement;

  async function checkBalance() {
    const { getAccountBalance } = await import("../../lib/stellar.ts");
    const { xlm, funded } = await getAccountBalance(adminAddress);

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

  el.querySelector("#refresh-btn")?.addEventListener("click", () => {
    balanceEl.textContent = "Checking...";
    balanceEl.style.color = "var(--text-muted)";
    cardEl.className = "stat-card";
    checkBalance();
  });

  // Friendbot funding
  el.querySelector("#fund-btn")?.addEventListener("click", async () => {
    const fundBtn = el.querySelector("#fund-btn") as HTMLButtonElement;
    fundBtn.disabled = true;
    fundBtn.textContent = "Funding...";
    errorEl.hidden = true;

    try {
      const res = await fetch(`${FRIENDBOT_URL}?addr=${adminAddress}`);
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

  return el;
}

export const fundView = onboardingPage("fund", renderStep);
