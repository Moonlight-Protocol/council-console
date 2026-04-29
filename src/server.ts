/**
 * Static file server for the council console.
 * Serves files from public/ with security headers and path sanitization.
 */
import { normalize, resolve } from "@std/path";

const PORT = Number(Deno.env.get("PORT") || "3020");
const PUBLIC_ROOT = resolve(Deno.cwd(), "public");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function getCSP(): string {
  const connectSrc = [
    "'self'",
    "https://soroban-testnet.stellar.org",
    "https://horizon-testnet.stellar.org",
    "https://friendbot.stellar.org",
    "https://api.github.com",
    "https://esm.sh",
    "https://cdn.esm.sh",
    "https://us.i.posthog.com",
    "https://otlp-gateway-prod-ca-east-0.grafana.net",
  ];

  // In development, allow connections to local services (Stellar RPC, council-platform, etc.)
  if (Deno.env.get("MODE") === "development") {
    connectSrc.push("http://localhost:*");
    // Docker Compose: allow connections to service hostnames (e.g. http://council:8080)
    const extraHosts = Deno.env.get("CSP_CONNECT_HOSTS");
    if (extraHosts) {
      extraHosts.split(",").forEach((h) => connectSrc.push(h.trim()));
    }
  }

  return [
    "default-src 'self'",
    "script-src 'self' https://us-assets.i.posthog.com https://esm.sh https://cdn.esm.sh",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc.join(" ")}`,
  ].join("; ");
}

function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Content-Security-Policy", getCSP());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function safePath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const resolved = resolve(PUBLIC_ROOT, "." + normalize("/" + decoded));
  if (!resolved.startsWith(PUBLIC_ROOT)) return null;
  return resolved;
}

const contentTypes: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  wasm: "application/wasm",
};

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";

  if (pathname.endsWith(".map")) {
    return addSecurityHeaders(new Response("Not Found", { status: 404 }));
  }

  const filePath = safePath(pathname);
  if (!filePath) {
    return addSecurityHeaders(new Response("Forbidden", { status: 403 }));
  }

  try {
    const file = await Deno.readFile(filePath);
    const ext = filePath.split(".").pop() || "";
    const cacheControl = ext === "html"
      ? "no-cache, no-store, must-revalidate"
      : "public, max-age=3600";
    return addSecurityHeaders(
      new Response(file, {
        headers: {
          "Content-Type": contentTypes[ext] || "application/octet-stream",
          "Cache-Control": cacheControl,
        },
      }),
    );
  } catch {
    const ext = pathname.split("/").pop()?.includes(".") ?? false;
    if (ext) {
      return addSecurityHeaders(new Response("Not Found", { status: 404 }));
    }
    try {
      const index = await Deno.readFile(resolve(PUBLIC_ROOT, "index.html"));
      return addSecurityHeaders(
        new Response(index, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );
    } catch {
      return addSecurityHeaders(new Response("Not Found", { status: 404 }));
    }
  }
});

console.log(`Council Console running on http://localhost:${PORT}`);
