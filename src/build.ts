/**
 * Bundles src/app.ts into public/app.js for the browser.
 * Uses esbuild via Deno with denoPlugins for import map resolution.
 */
// deno-lint-ignore no-import-prefix -- build script intentionally pins the URL
import * as esbuild from "https://deno.land/x/esbuild@v0.20.1/mod.js";
// deno-lint-ignore no-import-prefix -- build script intentionally pins the version
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@0.10";

const isProduction = Deno.args.includes("--production");
const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const version = denoJson.version ?? "0.0.0";

// Download contract WASMs from soroban-core GitHub release at build time
const WASM_DIR = "public/wasm";
const WASM_FILES = ["channel_auth_contract.wasm", "privacy_channel.wasm"];
const WASM_VERSION = Deno.env.get("SOROBAN_CORE_VERSION") || "latest";

async function resolvesorobanCoreVersion(): Promise<string> {
  const baseUrl =
    "https://api.github.com/repos/Moonlight-Protocol/soroban-core/releases";
  const releaseUrl = WASM_VERSION === "latest"
    ? `${baseUrl}/latest`
    : `${baseUrl}/tags/${WASM_VERSION}`;
  const res = await fetch(releaseUrl);
  if (!res.ok) return "unknown";
  const release = await res.json();
  return ((release.tag_name as string) ?? "unknown").replace(/^v/, "");
}

async function downloadWasms(): Promise<string> {
  try {
    await Deno.mkdir(WASM_DIR, { recursive: true });
  } catch { /* exists */ }

  // Always resolve the version (needed for build-time injection)
  const resolvedVersion = await resolvesorobanCoreVersion();

  // Check if already downloaded
  const allExist = (await Promise.all(
    WASM_FILES.map(async (f) => {
      try {
        await Deno.stat(`${WASM_DIR}/${f}`);
        return true;
      } catch {
        return false;
      }
    }),
  )).every(Boolean);

  if (allExist) {
    console.log(
      `Contract WASMs already present (soroban-core ${resolvedVersion}), skipping download.`,
    );
    return resolvedVersion;
  }

  const baseUrl =
    "https://api.github.com/repos/Moonlight-Protocol/soroban-core/releases";
  const releaseUrl = WASM_VERSION === "latest"
    ? `${baseUrl}/latest`
    : `${baseUrl}/tags/${WASM_VERSION}`;

  console.log(
    `Fetching contract WASMs from soroban-core ${resolvedVersion}...`,
  );
  const releaseRes = await fetch(releaseUrl);
  if (!releaseRes.ok) {
    throw new Error(`Failed to fetch release: ${releaseRes.status}`);
  }
  const release = await releaseRes.json();

  for (const name of WASM_FILES) {
    const asset = release.assets.find((a: { name: string }) => a.name === name);
    if (!asset) throw new Error(`WASM "${name}" not found in release`);
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) throw new Error(`Failed to download ${name}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await Deno.writeFile(`${WASM_DIR}/${name}`, bytes);
    console.log(`  ${name} (${bytes.length} bytes)`);
  }

  return resolvedVersion;
}

const sorobanCoreVersion = await downloadWasms();

await esbuild.build({
  entryPoints: ["src/app.ts"],
  bundle: true,
  outfile: "public/app.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: isProduction,
  sourcemap: !isProduction,
  define: {
    "__APP_VERSION__": JSON.stringify(version),
    "__SOROBAN_CORE_VERSION__": JSON.stringify(sorobanCoreVersion),
    "__DEV_MODE__": JSON.stringify(!isProduction),
  },
  inject: ["src/shims/buffer.ts"],
  treeShaking: false,
  plugins: [...denoPlugins({ configPath: `${Deno.cwd()}/deno.json` })],
});

// Patch: the wallets kit has transitive deps that use CJS require("buffer") and
// ESM import "buffer", which esbuild can't resolve through the Deno plugin.
// Fix both by: 1) patching __require to return our polyfill for "buffer",
// 2) removing the bare ESM import.
// Regexes use \s* to handle both minified and non-minified output.
let appJs = await Deno.readTextFile("public/app.js");
const before = appJs;

// Patch __require: intercept require("buffer") before it throws
appJs = appJs.replace(
  /throw\s*(Error\('Dynamic require of "'\s*\+\s*(\w+)\s*\+\s*'" is not supported'\))/,
  (_match, errExpr, varName) =>
    `if(${varName}==="buffer")return globalThis.__buffer_polyfill;throw ${errExpr}`,
);

if (appJs === before) {
  esbuild.stop();
  throw new Error(
    "Build failed: could not patch __require for buffer polyfill. " +
      "esbuild's CJS shim format may have changed.",
  );
}

// Remove ESM buffer imports — both bare ("buffer") and node-prefixed ("node:buffer").
// The shim at src/shims/buffer.ts is injected as a global, so any surviving
// import would attempt a network fetch and trip the browser CSP.
appJs = appJs.replace(
  /import\s*\{[^}]*\}\s*from\s*"(?:node:)?buffer"\s*;?/g,
  "",
);

// Defense in depth: any surviving `node:` specifier will be blocked by the
// browser CSP at runtime. Fail the build instead.
const surviving = appJs.match(/from\s*"node:[^"]+"/g);
if (surviving) {
  esbuild.stop();
  throw new Error(
    `Build failed: bundle contains node: specifiers that the browser cannot resolve:\n` +
      `  ${surviving.join("\n  ")}\n` +
      `Either extend the strip regex above, or remove the source-level import.`,
  );
}

await Deno.writeTextFile("public/app.js", appJs);

esbuild.stop();
console.log(`Built public/app.js${isProduction ? " (production)" : ""}`);
