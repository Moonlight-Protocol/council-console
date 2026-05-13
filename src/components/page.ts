import { renderNav } from "@moonlight/ui/nav";
import { pageLayout } from "@moonlight/ui/layout";
import {
  getConnectedAddress,
  isAuthenticated,
  isMasterSeedReady,
} from "../lib/wallet.ts";
import { isAuthenticated as isPlatformAuthed } from "../lib/platform.ts";
import { isAllowed } from "../lib/config.ts";
import { navigate } from "../lib/router.ts";
import { logout } from "../lib/auth.ts";

declare const __APP_VERSION__: string;

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

    const nav = renderNav({
      brand: "Council Console",
      version: __APP_VERSION__,
      address: addr,
      onLogout: logout,
    });
    const content = await renderContent();
    return pageLayout(nav, content);
  };
}
