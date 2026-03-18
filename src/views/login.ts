import { isAuthenticated, connectWallet } from "../lib/wallet.ts";
import { identify, capture } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";

export function loginView(): HTMLElement {
  if (isAuthenticated()) {
    navigate("/councils");
    return document.createElement("div");
  }

  const container = document.createElement("div");
  container.className = "login-container";
  container.innerHTML = `
    <div class="login-card">
      <h1>Council Console</h1>
      <p>Connect your Stellar wallet to deploy contracts, manage Privacy Providers, and monitor your council.</p>
      <button id="connect-btn" class="btn-primary btn-wide">Connect Wallet</button>
      <p id="login-status" class="hint-text" hidden></p>
      <p id="login-error" class="error-text" hidden></p>
      <p class="hint-text">Supports Freighter, LOBSTR, xBull, and other Stellar wallets via WalletConnect.</p>
    </div>
  `;

  const btn = container.querySelector("#connect-btn") as HTMLButtonElement;
  const statusEl = container.querySelector("#login-status") as HTMLParagraphElement;
  const errorEl = container.querySelector("#login-error") as HTMLParagraphElement;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    errorEl.hidden = true;

    try {
      statusEl.textContent = "Connecting wallet...";
      statusEl.hidden = false;

      const publicKey = await connectWallet();

      statusEl.textContent = `Connected: ${publicKey.slice(0, 8)}...${publicKey.slice(-4)}`;
      identify(publicKey);
      capture("council_login", { publicKey });
      navigate("/councils");
    } catch (error) {
      console.error("[login] wallet error:", error);
      errorEl.textContent = error instanceof Error ? error.message : "Failed to connect wallet";
      errorEl.hidden = false;
      statusEl.hidden = true;
      capture("council_login_failed");
    } finally {
      btn.disabled = false;
    }
  });

  return container;
}
