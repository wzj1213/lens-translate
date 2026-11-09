import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (manifest.version !== pkg.version) throw new Error("Package and extension versions must match.");

const paths = new Set([
  "LICENSE", "THIRD_PARTY_NOTICES.md", "reader.html", "image.html", "reader.css", "reader.js", "manifest.json", manifest.background.service_worker,
  manifest.action.default_popup, manifest.options_page, "popup.css", "popup.js", "options.css", "options.js",
  ...manifest.content_scripts.flatMap((script) => script.js),
  ...Object.values(manifest.icons),
  "_locales/en/messages.json", "_locales/zh_CN/messages.json",
]);
async function addVendor(folder) {
  for (const entry of await readdir("dist/" + folder, { withFileTypes: true })) {
    const path = folder + "/" + entry.name;
    if (entry.isDirectory()) await addVendor(path);
    else if (entry.isFile()) paths.add(path);
  }
}
await addVendor("vendor");
const files = {};
for (const path of [...paths].sort()) files[path] = await readFile("dist/" + path);

// ZIP records store local wall time. A fixed date gives identical bytes across rebuilds.
const archive = zipSync(files, { level: 9, mtime: new Date(2000, 0, 1) });
await mkdir("downloads", { recursive: true });
const output = "downloads/lens-translate-" + manifest.version + ".zip";
await writeFile(output, archive);
console.log(output);
