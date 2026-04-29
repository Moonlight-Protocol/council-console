import { onboardingPage } from "./layout.ts";
import { navigate } from "../../lib/router.ts";
import { COUNTRY_CODES } from "../../lib/jurisdictions.ts";
import { getFormDraft, saveFormDraft } from "../../lib/onboarding.ts";
import { capture } from "../../lib/analytics.ts";
import { escapeHtml } from "../../lib/dom.ts";

function renderStep(): HTMLElement {
  const el = document.createElement("div");

  // Restore draft if any
  const draft = getFormDraft("metadata") as {
    name?: string;
    description?: string;
    contactEmail?: string;
    jurisdictions?: string[];
  } | null;

  el.innerHTML = `
    <h2>Council</h2>
    <p style="color:var(--text-muted);margin-bottom:1.5rem">
      Tell us about your council. This information will be visible to privacy providers who want to join.
    </p>

    <div class="form-group">
      <label>Council Name *</label>
      <input type="text" id="council-name" placeholder="e.g. Moonlight Beta" value="${
    escapeHtml(draft?.name ?? "")
  }" />
    </div>

    <div class="form-group">
      <label>Description</label>
      <textarea id="council-description" rows="3" maxlength="500"
        placeholder="What does this council do?"
        style="width:100%;padding:0.6rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.875rem;font-family:var(--font-sans);resize:vertical"></textarea>
    </div>

    <div class="form-group">
      <label>Contact Email</label>
      <input type="email" id="council-email" placeholder="admin@example.com" value="${
    escapeHtml(draft?.contactEmail ?? "")
  }" />
    </div>

    <div class="form-group">
      <label>Jurisdictions</label>
      <div id="jurisdiction-tags" class="jurisdiction-tags"></div>
      <div class="jurisdiction-picker" id="jurisdiction-picker">
        <input type="text" id="jurisdiction-filter" placeholder="Search countries..." />
        <div class="jurisdiction-dropdown">
          <div id="jurisdiction-list" class="jurisdiction-list"></div>
        </div>
      </div>
    </div>

    <p id="meta-error" class="error-text" hidden></p>

    <button id="next-btn" class="btn-primary btn-wide" style="margin-top:1.5rem">Next</button>
  `;

  // Set textarea value via DOM to prevent </textarea> breakout XSS
  if (draft?.description) {
    (el.querySelector("#council-description") as HTMLTextAreaElement).value =
      draft.description;
  }

  // --- Jurisdiction picker ---
  const selectedJurisdictions = new Set<string>(draft?.jurisdictions ?? []);
  const tagsEl = el.querySelector("#jurisdiction-tags") as HTMLDivElement;
  const listEl = el.querySelector("#jurisdiction-list") as HTMLDivElement;
  const filterEl = el.querySelector("#jurisdiction-filter") as HTMLInputElement;
  const pickerEl = el.querySelector("#jurisdiction-picker") as HTMLDivElement;

  filterEl.addEventListener("focus", () => pickerEl.classList.add("open"));
  filterEl.addEventListener("blur", () => {
    // Delay to allow click on option to register before hiding
    setTimeout(() => pickerEl.classList.remove("open"), 200);
  });

  function renderTags() {
    tagsEl.innerHTML = "";
    for (const code of selectedJurisdictions) {
      const entry = COUNTRY_CODES.find((c) => c.code === code);
      if (!entry) continue;
      const tag = document.createElement("span");
      tag.className = "jurisdiction-tag";
      tag.textContent = `${entry.code} `;
      const x = document.createElement("button");
      x.textContent = "\u00d7";
      x.style.cssText =
        "background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0 0 0 0.25rem;font-size:1rem";
      x.addEventListener("click", () => {
        selectedJurisdictions.delete(code);
        renderTags();
        renderList(filterEl.value);
      });
      tag.appendChild(x);
      tagsEl.appendChild(tag);
    }
  }

  function renderList(filter: string) {
    listEl.innerHTML = "";
    const q = filter.toLowerCase();

    if (q.length < 2) {
      const hint = document.createElement("p");
      hint.style.cssText =
        "color:var(--text-muted);font-size:0.8rem;padding:0.5rem 0.75rem";
      hint.textContent = "Type at least 2 characters to search...";
      listEl.appendChild(hint);
      return;
    }

    for (const country of COUNTRY_CODES) {
      if (
        !country.label.toLowerCase().includes(q) &&
        !country.code.toLowerCase().includes(q)
      ) continue;
      const selected = selectedJurisdictions.has(country.code);
      const option = document.createElement("div");
      option.className = "jurisdiction-option" + (selected ? " selected" : "");
      const flag = country.code.toUpperCase().replace(
        /./g,
        (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65),
      );
      option.textContent = `${flag} ${country.label}`;
      option.addEventListener("click", () => {
        if (selected) selectedJurisdictions.delete(country.code);
        else selectedJurisdictions.add(country.code);
        renderTags();
        if (!selected) {
          filterEl.value = "";
          renderList("");
        } else renderList(filterEl.value);
      });
      listEl.appendChild(option);
    }
  }

  renderTags();
  renderList("");
  filterEl.addEventListener("input", () => renderList(filterEl.value));

  // Auto-save draft on input
  function saveDraft() {
    saveFormDraft("metadata", {
      name: (el.querySelector("#council-name") as HTMLInputElement).value
        .trim(),
      description:
        (el.querySelector("#council-description") as HTMLTextAreaElement).value
          .trim(),
      contactEmail: (el.querySelector("#council-email") as HTMLInputElement)
        .value.trim(),
      jurisdictions: Array.from(selectedJurisdictions),
    });
  }
  el.querySelector("#council-name")?.addEventListener("input", saveDraft);
  el.querySelector("#council-description")?.addEventListener(
    "input",
    saveDraft,
  );
  el.querySelector("#council-email")?.addEventListener("input", saveDraft);

  // --- Next button ---
  const errorEl = el.querySelector("#meta-error") as HTMLParagraphElement;
  const nextBtn = el.querySelector("#next-btn") as HTMLButtonElement;

  nextBtn.addEventListener("click", () => {
    const name = (el.querySelector("#council-name") as HTMLInputElement).value
      .trim();
    const description =
      (el.querySelector("#council-description") as HTMLTextAreaElement).value
        .trim();
    const contactEmail =
      (el.querySelector("#council-email") as HTMLInputElement).value.trim();
    const jurisdictions = Array.from(selectedJurisdictions);

    if (!name) {
      errorEl.textContent = "Council name is required";
      errorEl.hidden = false;
      return;
    }

    errorEl.hidden = true;

    // Save to sessionStorage — platform push happens in the create step
    saveFormDraft("metadata", {
      name,
      description,
      contactEmail,
      jurisdictions,
    });
    capture("onboarding_metadata_complete", { name });
    navigate("/create-council/create");
  });

  return el;
}

export const metadataView = onboardingPage("metadata", renderStep);
