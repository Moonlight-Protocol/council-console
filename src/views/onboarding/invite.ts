import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");

  const inviteLink = `${window.location.origin}${window.location.pathname}#/join`;

  el.innerHTML = `
    <h2>Invite privacy providers</h2>

    <div class="stat-card" style="margin-bottom:1.5rem">
      <span class="stat-label">Invite Link</span>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
        <input type="text" id="invite-link" readonly
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.5rem 0.75rem;color:var(--text);font-family:var(--font-mono);font-size:0.8rem" />
        <button id="copy-btn" class="btn-primary" style="padding:0.5rem 1rem;white-space:nowrap">Copy</button>
      </div>
    </div>

    <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:1.5rem">
      Providers who visit this link can submit a request to join. You'll review and approve them from the dashboard.
    </p>

    <div style="background:rgba(34,197,94,0.08);border:1px solid var(--active);border-radius:8px;padding:1.25rem;margin-bottom:1.5rem">
      <p style="color:var(--active);font-weight:600;margin-bottom:0.25rem">You're all set</p>
      <p style="font-size:0.85rem;color:var(--text-muted)">Manage your council, enable more assets, and review provider requests from the dashboard.</p>
    </div>

    <button id="done-btn" class="btn-primary btn-wide">Go to Dashboard</button>
  `;

  const linkInput = el.querySelector("#invite-link") as HTMLInputElement;
  linkInput.value = inviteLink;

  el.querySelector("#copy-btn")?.addEventListener("click", () => {
    navigator.clipboard.writeText(inviteLink).then(() => {
      const btn = el.querySelector("#copy-btn") as HTMLButtonElement;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    });
  });

  el.querySelector("#done-btn")?.addEventListener("click", () => navigate("/"));

  return el;
}

export const inviteView = onboardingPage("invite", renderStep);
