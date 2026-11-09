import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");
const outdir = "dist";

const base = {
  bundle: true,
  outdir,
  target: "chrome114",
  minify: !dev,
  sourcemap: dev,
  logLevel: "info",
};
const bundles = [
  { ...base, format: "esm", entryPoints: { service_worker: "src/background/service_worker.ts" } },
  {
    ...base,
    format: "iife",
    entryPoints: {
      content_script: "src/content/content_script.ts",
      options: "src/options/options.ts",
      popup: "src/popup/popup.ts",
    },
  },
];

const assets = [
  ["LICENSE", "LICENSE"],
  ["static/manifest.json", "manifest.json"],
  ["static/_locales", "_locales"],
  ["static/icons", "icons"],
  ["src/options/options.html", "options.html"],
  ["src/options/options.css", "options.css"],
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
];

async function copyAssets() {
  for (const [source, target] of assets) {
    await cp(source, `${outdir}/${target}`, { recursive: true });
  }
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir);
await copyAssets();

if (watch) {
  const contexts = await Promise.all(bundles.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  // esbuild tracks bundled files. Refresh the static assets as well.
  const { setTimeout } = await import("node:timers/promises");
  for (;;) {
    await setTimeout(1000);
    await copyAssets().catch((error) => console.error("Could not copy static assets", error));
  }
} else {
  await Promise.all(bundles.map((options) => esbuild.build(options)));
}
