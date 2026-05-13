/**
 * Shared onboarding layout — uses the same nav as the main app, with the
 * stepper rendered above the step content.
 */
import { renderNav } from "@moonlight/ui/nav";
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

    const wrapper = document.createElement("div");
    wrapper.appendChild(renderNav({
      brand: "Council Console",
      version: __APP_VERSION__,
      address: addr,
      onLogout: logout,
    }));

    const main = document.createElement("main");
    main.className = "container";

    main.appendChild(renderStepper({
      steps: ONBOARDING_STEPS,
      currentStepId: currentStep,
    }));

    const content = document.createElement("div");
    content.className = "onboarding-content";
    const rendered = await renderStep();
    content.appendChild(rendered);
    main.appendChild(content);

    wrapper.appendChild(main);
    return wrapper;
  };
}
