import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { clearFormDraft, getFormDraft } from "../../lib/onboarding.ts";
import { COUNTRY_CODES } from "../../lib/jurisdictions.ts";
import {
  addJurisdiction,
  authenticate,
  isPlatformConfigured,
  pushMetadata,
  registerChannel,
} from "../../lib/platform.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");

  if (!isPlatformConfigured()) {
    navigate("/create-council/invite");
    return el;
  }

  el.innerHTML = `
    <h2>Register your council</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      To share your council with providers, we need to register it with the council platform.
      Your wallet will ask you to approve <strong>1 signature</strong> to authenticate.
    </p>

    <p id="register-status" class="hint-text" hidden></p>
    <p id="register-error" class="error-text" hidden></p>

    <button id="register-btn" class="btn-primary btn-wide">Register & Continue</button>
  `;

  const registerBtn = el.querySelector("#register-btn") as HTMLButtonElement;
  const statusEl = el.querySelector("#register-status") as HTMLParagraphElement;
  const errorEl = el.querySelector("#register-error") as HTMLParagraphElement;

  registerBtn.addEventListener("click", async () => {
    registerBtn.disabled = true;
    registerBtn.textContent = "Registering...";
    errorEl.hidden = true;
    statusEl.textContent = "Signing in to council platform...";
    statusEl.hidden = false;

    try {
      await authenticate();

      statusEl.textContent = "Pushing council info...";

      const metadata = getFormDraft("metadata") as {
        name?: string;
        description?: string;
        contactEmail?: string;
        jurisdictions?: string[];
      } | null;

      if (metadata?.name) {
        await pushMetadata({
          name: metadata.name,
          description: metadata.description || undefined,
          contactEmail: metadata.contactEmail || undefined,
        });
      }

      if (metadata?.jurisdictions) {
        for (const code of metadata.jurisdictions) {
          const entry = COUNTRY_CODES.find((c) => c.code === code);
          await addJurisdiction(code, entry?.label);
        }
      }

      // Read the privacy channel ID from create progress (localStorage),
      // since we no longer store councils in localStorage via store.ts.
      const councilId = sessionStorage.getItem("onboarding_council_id");
      let privacyChannelId: string | undefined;
      try {
        const progress = JSON.parse(
          localStorage.getItem("council_create_progress") || "{}",
        );
        privacyChannelId = progress.privacyChannelId;
      } catch { /* no progress */ }

      if (privacyChannelId && councilId) {
        const { getAssetContractId } = await import("../../lib/stellar.ts");
        const assetContractId = await getAssetContractId("XLM");
        await registerChannel({
          channelContractId: privacyChannelId,
          assetCode: "XLM",
          assetContractId,
          label: "XLM Privacy Channel",
        });
      }

      clearFormDraft("metadata");
      navigate("/create-council/invite");
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.hidden = false;
      registerBtn.disabled = false;
      registerBtn.textContent = "Retry";
      statusEl.hidden = true;
    }
  });

  return el;
}

export const registerView = onboardingPage("invite", renderStep);
