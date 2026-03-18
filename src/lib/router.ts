/**
 * Minimal hash-based router for SPA navigation.
 * Routes are defined as hash paths: #/login, #/deploy, #/providers, etc.
 */

type RouteHandler = () => HTMLElement | Promise<HTMLElement>;

const routes = new Map<string, RouteHandler>();
let cleanups: (() => void)[] = [];

export function route(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function navigate(path: string): void {
  window.location.hash = path;
}

async function render(): Promise<void> {
  const hash = window.location.hash || "#/";
  const path = hash.startsWith("#") ? hash.slice(1) : hash;

  const handler = routes.get(path) || routes.get("/404");
  if (!handler) return;

  for (const fn of cleanups) {
    fn();
  }
  cleanups = [];

  const app = document.getElementById("app");
  if (!app) return;

  const element = await handler();
  app.innerHTML = "";
  app.appendChild(element);

  window.scrollTo(0, 0);
}

export function startRouter(): void {
  window.addEventListener("hashchange", render);
  render();
}

export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}
