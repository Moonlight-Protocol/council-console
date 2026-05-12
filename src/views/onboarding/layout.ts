/**
 * Onboarding wrapper — auth check, nav, stepper, and content slot.
 * Stepper rendering comes from @moonlight/ui; the step vocabulary
 * (ONBOARDING_STEPS) stays app-side.
 */
import { renderNav } from "@moonlight/ui/nav";
import { pageLayout } from "@moonlight/ui/layout";
import { renderStepper } from "@moonlight/ui/stepper";
import { getConnectedAddress, isAuthenticated } from "../../lib/wallet.ts";
import { isAllowed } from "../../lib/config.ts";
import { navigate } from "../../lib/router.ts";
import { logout } from "../../lib/auth.ts";
import {
  ONBOARDING_STEPS,
  type OnboardingStepId,
} from "../../lib/onboarding.ts";

declare const __APP_VERSION__: string;

export function onboardingPage(
  currentStep: OnboardingStepId,
  renderStep: () => HTMLElement | Promise<HTMLElement>,
): () => Promise<HTMLElement> {
  return async () => {
    const addr = getConnectedAddress();
    if (!isAuthenticated() || (addr && !isAllowed(addr))) {
      navigate("/login");
      return document.createElement("div");
    }

    const nav = renderNav({
      brand: "Council Console",
      version: __APP_VERSION__,
      address: addr,
      onLogout: logout,
    });

    const stepper = renderStepper({
      steps: ONBOARDING_STEPS,
      currentStepId: currentStep,
    });

    const content = document.createElement("div");
    content.className = "onboarding-content";
    const rendered = await renderStep();
    content.appendChild(rendered);

    const main = document.createElement("div");
    main.appendChild(stepper);
    main.appendChild(content);

    return pageLayout(nav, main);
  };
}
