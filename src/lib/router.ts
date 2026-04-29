/**
 * Minimal hash-based router for SPA navigation.
 * Routes are defined as hash paths: #/login, #/deploy, #/providers, etc.
 */
import { renderError } from "./dom.ts";

type RouteHandler = () => HTMLElement | Promise<HTMLElement>;

const routes = new Map<string, RouteHandler>();
let cleanups: (() => void)[] = [];

export function route(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function navigate(path: string, opts?: { force?: boolean }): void {
  const current = globalThis.location.hash.replace(/^#/, "");
  if (opts?.force && current === path) {
    render();
  } else {
    globalThis.location.hash = path;
  }
}

async function render(): Promise<void> {
  const hash = globalThis.location.hash || "#/";
  const path = hash.startsWith("#")
    ? hash.slice(1).split("?")[0]
    : hash.split("?")[0];

  const handler = routes.get(path) || routes.get("/404");
  if (!handler) return;

  for (const fn of cleanups) {
    fn();
  }
  cleanups = [];

  const app = document.getElementById("app");
  if (!app) return;

  try {
    const element = await handler();
    app.innerHTML = "";
    app.appendChild(element);
  } catch (error) {
    app.innerHTML = "";
    const container = document.createElement("main");
    container.className = "container";
    renderError(
      container,
      "Something went wrong",
      error instanceof Error ? error.message : String(error),
    );
    app.appendChild(container);
  }

  globalThis.scrollTo(0, 0);
}

export function startRouter(): void {
  globalThis.addEventListener("hashchange", render);
  render();
}

export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}
