/**
 * Bundles src/app.ts into public/app.js for the browser.
 * Uses esbuild via Deno with denoPlugins for import map resolution.
 */
import * as esbuild from "https://deno.land/x/esbuild@v0.20.1/mod.js";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@0.10";

const isProduction = Deno.args.includes("--production");
const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const version = denoJson.version ?? "0.0.0";

await esbuild.build({
  entryPoints: ["src/app.ts"],
  bundle: true,
  outfile: "public/app.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: isProduction,
  sourcemap: !isProduction,
  define: { "__APP_VERSION__": JSON.stringify(version) },
  inject: ["src/shims/buffer.ts"],
  plugins: [...denoPlugins({ configPath: `${Deno.cwd()}/deno.json` })],
});

// Patch dynamic require for buffer polyfill (stellar-sdk transitive deps)
let appJs = await Deno.readTextFile("public/app.js");
appJs = appJs.replace(
  `throw Error('Dynamic require of "' + x + '" is not supported')`,
  `if(x==="buffer")return globalThis.__buffer_polyfill;throw Error('Dynamic require of "' + x + '" is not supported')`,
);
appJs = appJs.replace(
  /import \{ Buffer as Buffer\d* \} from "buffer";/g,
  "",
);
await Deno.writeTextFile("public/app.js", appJs);

esbuild.stop();
console.log(`Built public/app.js${isProduction ? " (production)" : ""}`);
