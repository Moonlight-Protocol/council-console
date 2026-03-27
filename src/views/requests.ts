import { page } from "../components/page.ts";
import { escapeHtml, truncateAddress } from "../lib/dom.ts";
import { navigate } from "../lib/router.ts";
import { capture } from "../lib/analytics.ts";
import {
  isPlatformConfigured,
  isAuthenticated as isPlatformAuthed,
  authenticate,
  listJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  type JoinRequest,
} from "../lib/platform.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  if (!isPlatformConfigured()) {
    el.innerHTML = `
      <h2>Provider Requests</h2>
      <div class="empty-state">
        <p>Council platform is not configured. Set <code>platformUrl</code> in config to manage join requests.</p>
      </div>
    `;
    return el;
  }

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Provider Requests</h2>
      <a href="#/" class="btn-link">Back to Councils</a>
    </div>

    <div style="margin:1rem 0">
      <label style="font-size:0.85rem;color:var(--text-muted);margin-right:0.5rem">Invite link:</label>
      <input type="text" id="invite-link" readonly
        style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.4rem 0.75rem;color:var(--text);font-family:var(--font-mono);font-size:0.8rem;width:350px" />
      <button id="copy-link-btn" class="btn-primary" style="margin-left:0.5rem;padding:0.4rem 1rem">Copy</button>
    </div>

    <div id="requests-loading" style="color:var(--text-muted);margin:1.5rem 0">Loading requests...</div>
    <div id="requests-content" hidden></div>
    <p id="requests-error" class="error-text" hidden></p>
  `;

  // Set invite link
  const inviteLink = `${window.location.origin}${window.location.pathname}#/join`;
  const linkInput = el.querySelector("#invite-link") as HTMLInputElement;
  linkInput.value = inviteLink;

  el.querySelector("#copy-link-btn")?.addEventListener("click", () => {
    navigator.clipboard.writeText(inviteLink).then(() => {
      const btn = el.querySelector("#copy-link-btn") as HTMLButtonElement;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    });
  });

  // Load requests
  const loadingEl = el.querySelector("#requests-loading") as HTMLDivElement;
  const contentEl = el.querySelector("#requests-content") as HTMLDivElement;
  const errorEl = el.querySelector("#requests-error") as HTMLParagraphElement;

  function renderRequests(requests: JoinRequest[]) {
    if (requests.length === 0) {
      contentEl.innerHTML = `
        <div class="empty-state">
          <p>No pending requests. Share the invite link with privacy providers.</p>
        </div>
      `;
      contentEl.hidden = false;
      return;
    }

    const rows = requests.map((r) => `
      <tr data-id="${escapeHtml(r.id)}">
        <td class="mono">${escapeHtml(truncateAddress(r.publicKey))}</td>
        <td>${escapeHtml(r.label || "-")}</td>
        <td>${escapeHtml(r.contactEmail || "-")}</td>
        <td><span class="badge badge-${r.status === "PENDING" ? "pending" : r.status === "APPROVED" ? "active" : "inactive"}">${escapeHtml(r.status)}</span></td>
        <td>${new Date(r.createdAt).toLocaleDateString()}</td>
        <td style="white-space:nowrap">
          ${r.status === "PENDING" ? `
            <button class="btn-link approve-btn" data-id="${escapeHtml(r.id)}" style="color:var(--active)">Approve</button>
            <button class="btn-link reject-btn" data-id="${escapeHtml(r.id)}" style="color:var(--inactive);margin-left:0.5rem">Reject</button>
          ` : ""}
        </td>
      </tr>
    `).join("");

    contentEl.innerHTML = `
      <table>
        <thead><tr><th>Public Key</th><th>Label</th><th>Email</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    contentEl.hidden = false;

    // Wire approve buttons
    contentEl.querySelectorAll(".approve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        (btn as HTMLButtonElement).disabled = true;
        (btn as HTMLButtonElement).textContent = "Approving...";
        try {
          await approveJoinRequest(id);
          capture("council_join_request_approved", { requestId: id });
          await loadRequests();
        } catch (err) {
          errorEl.textContent = err instanceof Error ? err.message : String(err);
          errorEl.hidden = false;
        }
      });
    });

    // Wire reject buttons
    contentEl.querySelectorAll(".reject-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (!id) return;
        if (!confirm("Reject this join request?")) return;
        (btn as HTMLButtonElement).disabled = true;
        try {
          await rejectJoinRequest(id);
          capture("council_join_request_rejected", { requestId: id });
          await loadRequests();
        } catch (err) {
          errorEl.textContent = err instanceof Error ? err.message : String(err);
          errorEl.hidden = false;
        }
      });
    });
  }

  async function loadRequests() {
    loadingEl.hidden = false;
    contentEl.hidden = true;
    errorEl.hidden = true;
    try {
      const requests = await listJoinRequests();
      loadingEl.hidden = true;
      renderRequests(requests);
    } catch (err) {
      loadingEl.hidden = true;
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.hidden = false;
    }
  }

  if (isPlatformAuthed()) {
    loadRequests();
  } else {
    loadingEl.hidden = true;
    contentEl.innerHTML = `
      <p style="color:var(--text-muted);margin-bottom:1rem">Sign in to the council platform to view provider requests.</p>
      <button id="auth-btn" class="btn-primary">Sign In (1 signature)</button>
    `;
    contentEl.hidden = false;
    contentEl.querySelector("#auth-btn")?.addEventListener("click", async () => {
      const btn = contentEl.querySelector("#auth-btn") as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "Signing in...";
      try {
        await authenticate();
        await loadRequests();
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : String(err);
        errorEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Retry";
      }
    });
  }

  return el;
}

export const requestsView = page(renderContent);
