import { renderInviteWaitlist } from "@moonlight/ui/invite-waitlist";
import {
  clearSession,
  connectWallet,
  getConnectedAddress,
  initMasterSeed,
  isAuthenticated,
  isMasterSeedReady,
} from "../lib/wallet.ts";
import { capture, identify } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";
import {
  authenticate,
  clearPlatformAuth,
  isAuthenticated as isPlatformAuthed,
} from "../lib/platform.ts";
import { escapeHtml, friendlyError } from "../lib/dom.ts";
import { isAllowed, PLATFORM_URL } from "../lib/config.ts";

function inviteWaitlistView(address: string): HTMLElement {
  return renderInviteWaitlist({
    address,
    platformUrl: PLATFORM_URL,
    logoSrc: "/moonlight.png",
    ids: { emailInput: "waitlist-email" },
    onDisconnect: () => {
      clearSession();
      clearPlatformAuth();
      navigate("/login", { force: true });
    },
  });
}

export function loginView(): HTMLElement {
  const existingAddr = getConnectedAddress();
  if (isAuthenticated() && isMasterSeedReady() && isPlatformAuthed()) {
    if (existingAddr && !isAllowed(existingAddr)) {
      return inviteWaitlistView(existingAddr);
    }
    navigate("/");
    return document.createElement("div");
  }

  const container = document.createElement("div");
  container.className = "login-container";

  const walletConnected = isAuthenticated();
  const address = getConnectedAddress();

  container.innerHTML = `
    <div class="login-card">
      <h1>Council Console</h1>

      <div id="step-connect" ${walletConnected ? "hidden" : ""}>
        <p>Connect your Stellar wallet to get started.</p>
        <button id="connect-btn" class="btn-primary btn-wide">Connect Wallet</button>
      </div>

      <div id="step-signin" ${walletConnected ? "" : "hidden"}>
        <p>Connected as:</p>
        <p class="mono" style="font-size:0.8rem;word-break:break-all;margin-bottom:1rem;color:var(--text-muted)">${
    escapeHtml(address || "")
  }</p>
        <button id="signin-btn" class="btn-primary btn-wide">Sign In</button>
        <button id="change-wallet-btn" class="btn-link" style="margin-top:0.75rem;display:block;text-align:center;width:100%;color:var(--text-muted)">Use a different wallet</button>
      </div>

      <p id="login-error" class="error-text" style="text-align:center" hidden></p>
    </div>
  `;

  const connectStep = container.querySelector(
    "#step-connect",
  ) as HTMLDivElement;
  const signinStep = container.querySelector("#step-signin") as HTMLDivElement;
  const errorEl = container.querySelector(
    "#login-error",
  ) as HTMLParagraphElement;

  // Change wallet: clear session and go back to step 1
  container.querySelector("#change-wallet-btn")?.addEventListener(
    "click",
    () => {
      clearSession();
      clearPlatformAuth();
      connectStep.hidden = false;
      signinStep.hidden = true;
      errorEl.hidden = true;
      (container.querySelector("#connect-btn") as HTMLButtonElement).disabled =
        false;
    },
  );

  // Step 1: Connect Wallet
  container.querySelector("#connect-btn")?.addEventListener(
    "click",
    async () => {
      const btn = container.querySelector("#connect-btn") as HTMLButtonElement;
      btn.disabled = true;
      errorEl.hidden = true;

      try {
        const publicKey = await connectWallet();
        identify(publicKey);

        // Show step 2 with the public key
        connectStep.hidden = true;
        signinStep.hidden = false;
        const addrEl = signinStep.querySelector(".mono") as HTMLElement;
        addrEl.textContent = publicKey;

        capture("council_wallet_connected", { publicKey });
      } catch (error) {
        errorEl.textContent = friendlyError(error);
        errorEl.hidden = false;
        btn.disabled = false;
      }
    },
  );

  // Step 2: Sign In (platform auth)
  container.querySelector("#signin-btn")?.addEventListener(
    "click",
    async () => {
      const btn = container.querySelector("#signin-btn") as HTMLButtonElement;
      const originalText = btn.textContent;
      btn.disabled = true;
      errorEl.hidden = true;

      try {
        btn.textContent = "Setting up...";
        await initMasterSeed();
        // Freighter rejects consecutive signMessage calls without a delay between them.
        // initMasterSeed signs once, and authenticate() signs again immediately after.
        await new Promise((r) => setTimeout(r, 1000));
        btn.textContent = "Authenticating...";
        await authenticate();
        const addr = getConnectedAddress();
        capture("council_login", { publicKey: addr });
        if (addr && !isAllowed(addr)) {
          container.replaceWith(inviteWaitlistView(addr));
          return;
        }
        navigate("/");
      } catch (error) {
        errorEl.textContent = friendlyError(error);
        errorEl.hidden = false;
        btn.textContent = originalText;
        btn.disabled = false;
      }
    },
  );

  return container;
}
