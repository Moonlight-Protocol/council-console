/**
 * Shared onboarding layout with progress stepper.
 * Uses a minimal nav (no dashboard/providers/requests links).
 */
import { isAuthenticated } from "../../lib/wallet.ts";
import { navigate } from "../../lib/router.ts";
import { renderNav } from "../../components/nav.ts";
import { ONBOARDING_STEPS, type OnboardingStepId } from "../../lib/onboarding.ts";

export function onboardingPage(
  currentStep: OnboardingStepId,
  renderStep: () => HTMLElement | Promise<HTMLElement>,
): () => Promise<HTMLElement> {
  return async () => {
    if (!isAuthenticated()) {
      navigate("/login");
      return document.createElement("div");
    }

    const wrapper = document.createElement("div");
    wrapper.appendChild(renderNav());

    const main = document.createElement("main");
    main.className = "container";

    // Progress stepper
    const stepper = document.createElement("div");
    stepper.className = "onboarding-stepper";

    const currentIdx = ONBOARDING_STEPS.findIndex((s) => s.id === currentStep);

    for (let i = 0; i < ONBOARDING_STEPS.length; i++) {
      const step = ONBOARDING_STEPS[i];
      const stepEl = document.createElement("div");
      stepEl.className = "onboarding-step";
      if (i < currentIdx) stepEl.classList.add("done");
      if (i === currentIdx) stepEl.classList.add("active");

      const dot = document.createElement("span");
      dot.className = "step-dot";
      dot.textContent = i < currentIdx ? "\u2713" : String(i + 1);

      const label = document.createElement("span");
      label.className = "step-label";
      label.textContent = step.label;

      stepEl.append(dot, label);
      stepper.appendChild(stepEl);

      if (i < ONBOARDING_STEPS.length - 1) {
        const line = document.createElement("div");
        line.className = "step-line";
        if (i < currentIdx) line.classList.add("done");
        stepper.appendChild(line);
      }
    }

    main.appendChild(stepper);

    // Step content
    const content = document.createElement("div");
    content.className = "onboarding-content";
    const rendered = await renderStep();
    content.appendChild(rendered);
    main.appendChild(content);

    wrapper.appendChild(main);
    return wrapper;
  };
}
