import * as esbuild from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";

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
  { ...base, format: "esm", entryPoints: { service_worker: "src/background/service_worker.ts", reader: "src/reader/reader.ts" } },
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
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
  ["src/reader/reader.html", "reader.html"],
  ["src/reader/reader.html", "image.html"],
  ["src/reader/reader.css", "reader.css"],
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

async function copyReaderLibraries() {
  const pdf = "node_modules/pdfjs-dist/";
  const ocr = "node_modules/tesseract.js/";
  const from = [
    [pdf + "legacy/build/pdf.min.mjs", "pdf/pdf.mjs"],
    [pdf + "legacy/build/pdf.worker.min.mjs", "pdf/pdf.worker.mjs"],
    ...["LICENSE", "cmaps", "standard_fonts", "iccs"].map(name => [pdf + name, "pdf/" + name]),
    ...((await readdir(pdf + "wasm")).filter(name => !name.toLowerCase().includes("quickjs"))
      .map(name => [pdf + "wasm/" + name, "pdf/wasm/" + name])),
    [ocr + "dist/worker.min.js", "ocr/worker.min.js"],
    [ocr + "dist/worker.min.js.LICENSE.txt", "ocr/worker.min.js.LICENSE.txt"],
    [ocr + "dist/tesseract.min.js.LICENSE.txt", "ocr/tesseract.min.js.LICENSE.txt"],
    [ocr + "LICENSE.md", "ocr/LICENSE-tesseract.md"],
    ["node_modules/tesseract.js-core/LICENSE", "ocr/LICENSE-core"],
    ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "ocr/tesseract-core-lstm.wasm.js"],
    ...["eng", "chi_sim", "jpn"].map(lang => [
      "node_modules/@tesseract.js-data/" + lang + "/4.0.0_best_int/" + lang + ".traineddata.gz",
      "ocr/" + lang + ".traineddata.gz",
    ]),
  ];
  for (const [source, target] of from) await cp(source, outdir + "/vendor/" + target, { recursive: true });
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir);
await Promise.all([copyAssets(), copyReaderLibraries()]);

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
