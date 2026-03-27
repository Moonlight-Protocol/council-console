/**
 * Public join request form — no authentication required.
 * Reached via the invite link shared by the council admin.
 */
import { escapeHtml } from "../lib/dom.ts";
import { PLATFORM_URL } from "../lib/config.ts";
import { submitJoinRequest } from "../lib/platform.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  el.className = "login-container";

  if (!PLATFORM_URL) {
    el.innerHTML = `
      <div class="login-card">
        <h1 style="color:var(--inactive)">Not Available</h1>
        <p>This council console is not connected to a council platform.</p>
      </div>
    `;
    return el;
  }

  el.innerHTML = `
    <div class="login-card" style="max-width:480px">
      <h1 style="color:var(--primary)">Join as a Privacy Provider</h1>
      <p>Submit a request to join this council. The council admin will review your application.</p>

      <div class="form-group">
        <label>Stellar Public Key</label>
        <input type="text" id="join-pubkey" placeholder="G..." />
      </div>

      <div class="form-group">
        <label>Label (optional)</label>
        <input type="text" id="join-label" placeholder="Your organization name" />
      </div>

      <div class="form-group">
        <label>Contact Email (optional)</label>
        <input type="email" id="join-email" placeholder="you@example.com" />
      </div>

      <button id="join-submit" class="btn-primary btn-wide" style="margin-top:1rem">Submit Request</button>

      <p id="join-error" class="error-text" hidden></p>
      <div id="join-success" hidden style="margin-top:1rem;padding:1rem;background:rgba(34,197,94,0.1);border:1px solid var(--active);border-radius:8px">
        <p style="color:var(--active);font-weight:600;margin-bottom:0.25rem">Request Submitted</p>
        <p style="font-size:0.85rem;color:var(--text-muted)">The council admin will review your request. You'll be added as a provider if approved.</p>
      </div>
    </div>
  `;

  const submitBtn = el.querySelector("#join-submit") as HTMLButtonElement;
  const errorEl = el.querySelector("#join-error") as HTMLParagraphElement;
  const successEl = el.querySelector("#join-success") as HTMLDivElement;

  submitBtn.addEventListener("click", async () => {
    const publicKey = (el.querySelector("#join-pubkey") as HTMLInputElement).value.trim();
    const label = (el.querySelector("#join-label") as HTMLInputElement).value.trim();
    const contactEmail = (el.querySelector("#join-email") as HTMLInputElement).value.trim();

    if (!publicKey) {
      errorEl.textContent = "Stellar public key is required";
      errorEl.hidden = false;
      return;
    }

    let validKey = false;
    try {
      const { sdk } = await import("../lib/stellar.ts");
      const { StrKey } = await sdk();
      validKey = StrKey.isValidEd25519PublicKey(publicKey);
    } catch {
      validKey = publicKey.startsWith("G") && publicKey.length === 56;
    }
    if (!validKey) {
      errorEl.textContent = "Invalid Stellar public key";
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
    errorEl.hidden = true;

    try {
      await submitJoinRequest({
        publicKey,
        label: label || undefined,
        contactEmail: contactEmail || undefined,
      });
      submitBtn.hidden = true;
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Request";
    }
  });

  return el;
}

// Note: this view does NOT use page() wrapper — no auth check, no nav
export const joinView = renderContent;
