import { route, startRouter } from "./lib/router.ts";
import { initAnalytics } from "./lib/analytics.ts";
import { initTracer } from "./lib/tracer.ts";
import { OTEL_ENDPOINT } from "./lib/config.ts";

import { loginView } from "./views/login.ts";
import { councilsView } from "./views/councils.ts";
import { councilDetailView } from "./views/council-detail.ts";
import { requestsView } from "./views/requests.ts";
import { joinView } from "./views/join.ts";
import { importCouncilView } from "./views/import-council.ts";

// Council creation steps
import { metadataView } from "./views/onboarding/metadata.ts";
import { fundView } from "./views/onboarding/fund.ts";
import { createView } from "./views/onboarding/create.ts";
import { assetsView } from "./views/onboarding/assets.ts";
import { inviteView } from "./views/onboarding/invite.ts";

initAnalytics();
initTracer({ endpoint: OTEL_ENDPOINT });

// Auth
route("/login", loginView);

// Home (council list)
route("/", councilsView);
route("/council", councilDetailView);
route("/requests", requestsView);

// Council creation
route("/create-council/metadata", metadataView);
route("/create-council/fund", fundView);
route("/create-council/create", createView);
route("/create-council/assets", assetsView);
route("/create-council/invite", inviteView);

// Import
route("/import-council", importCouncilView);

// Public (no auth)
route("/join", joinView);

route("/404", () => {
  const el = document.createElement("div");
  el.className = "login-container";
  el.innerHTML = `<div class="login-card"><h1>404</h1><p>Page not found.</p><a href="#/">Back</a></div>`;
  return el;
});

startRouter();

// Dev-mode version check — __DEV_MODE__ is false in production, esbuild removes the block
import { checkVersions } from "./lib/version-check.ts";
declare const __DEV_MODE__: boolean;
if (__DEV_MODE__) {
  checkVersions().then((banner) => {
    if (banner) document.body.prepend(banner);
  });
}
