import { route, startRouter, navigate } from "./lib/router.ts";
import { initAnalytics } from "./lib/analytics.ts";
import { initTracer } from "./lib/tracer.ts";
import { isAuthenticated } from "./lib/wallet.ts";
import { OTEL_ENDPOINT, OTEL_AUTH } from "./lib/config.ts";

import { loginView } from "./views/login.ts";
import { councilsView } from "./views/councils.ts";
import { deployView } from "./views/deploy.ts";
import { providersView } from "./views/providers.ts";

initAnalytics();
initTracer({ endpoint: OTEL_ENDPOINT, auth: OTEL_AUTH });

route("/login", loginView);
route("/councils", councilsView);
route("/deploy", deployView);
route("/providers", providersView);

route("/", () => {
  if (isAuthenticated()) {
    navigate("/councils");
  } else {
    navigate("/login");
  }
  return document.createElement("div");
});

route("/404", () => {
  const el = document.createElement("div");
  el.className = "login-container";
  el.innerHTML = `<div class="login-card"><h1>404</h1><p>Page not found.</p><a href="#/councils">Back to dashboard</a></div>`;
  return el;
});

startRouter();
