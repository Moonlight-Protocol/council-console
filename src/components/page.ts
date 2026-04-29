import { renderNav } from "./nav.ts";
import {
  getConnectedAddress,
  isAuthenticated,
  isMasterSeedReady,
} from "../lib/wallet.ts";
import { isAuthenticated as isPlatformAuthed } from "../lib/platform.ts";
import { isAllowed } from "../lib/config.ts";
import { navigate } from "../lib/router.ts";

/**
 * Wraps a view with the nav bar and auth check.
 * Requires wallet connection, master seed, AND platform authentication.
 */
export function page(
  renderContent: () => HTMLElement | Promise<HTMLElement>,
): () => Promise<HTMLElement> {
  return async () => {
    const addr = getConnectedAddress();
    if (
      !isAuthenticated() || !isMasterSeedReady() || !isPlatformAuthed() ||
      (addr && !isAllowed(addr))
    ) {
      navigate("/login");
      return document.createElement("div");
    }

    const wrapper = document.createElement("div");
    wrapper.appendChild(renderNav());

    const main = document.createElement("main");
    main.className = "container";
    const content = await renderContent();
    main.appendChild(content);
    wrapper.appendChild(main);

    return wrapper;
  };
}
