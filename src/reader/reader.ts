import type { PDFDocumentProxy } from "pdfjs-dist";
import { applyI18n, t } from "@shared/i18n";
import { translateText } from "@shared/translateText";
import { openPdf, renderPdf } from "./pdf";
import { recognize } from "./ocr";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (message: string) => { el("status").textContent = message; };
const source = el<HTMLTextAreaElement>("source");
const file = el<HTMLInputElement>("file");
const image = el<HTMLImageElement>("image");
let pdf: PDFDocumentProxy | undefined, picture: Blob | undefined, imageUrl = "", pageNumber = 1;
let documentWork = new AbortController(), pageWork = new AbortController(), textWork = new AbortController(), ocrWork = new AbortController();
const mode = new URLSearchParams(location.search);
applyI18n();
document.documentElement.lang = chrome.i18n.getUILanguage();
el("settings").onclick = () => { void chrome.runtime.openOptionsPage(); };

function resetDocument(): AbortSignal {
  documentWork.abort(); pageWork.abort(); textWork.abort(); ocrWork.abort();
  documentWork = new AbortController();
  if (pdf) void pdf.loadingTask.destroy().catch(() => {});
  pdf = undefined; picture = undefined; pageNumber = 1;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = ""; image.removeAttribute("src");
  source.value = ""; el("result").textContent = "";
  el("workspace").hidden = true; el("pages").hidden = true;
  return documentWork.signal;
}

async function translate(): Promise<void> {
  textWork.abort(); textWork = new AbortController();
  const signal = textWork.signal;
  const text = source.value.trim();
  el("result").textContent = "";
  if (!text) return;
  status(t("translating"));
  const lang = el<HTMLSelectElement>("ocrLang").value;
  try {
    const result = await translateText(text, { sourceHint: picture ? ({ eng: "en", chi_sim: "zh", jpn: "ja" }[lang]) : "", signal });
    if (!signal.aborted) { el("result").textContent = result; status(t("panelTranslated")); }
  } catch (error) { if (!signal.aborted) status(String(error)); }
}
el("translate").onclick = () => { void translate(); };
source.oninput = () => { textWork.abort(); el("result").textContent = ""; };

async function readImage(): Promise<void> {
  if (!picture) return;
  ocrWork.abort(); textWork.abort();
  ocrWork = new AbortController();
  const signal = ocrWork.signal;
  source.value = ""; el("result").textContent = ""; status(t("ocrLoading"));
  try {
    const text = await recognize(picture, el<HTMLSelectElement>("ocrLang").value, signal, status);
    if (signal.aborted) return;
    source.value = text;
    if (text) await translate(); else status(t("ocrEmpty"));
  } catch (error) { if (!signal.aborted) status(String(error)); }
}
el("recognize").onclick = () => { void readImage(); };
el("ocrLang").onchange = () => { void readImage(); };

async function showPage(number: number): Promise<void> {
  if (!pdf || number < 1 || number > pdf.numPages) return;
  pageWork.abort(); textWork.abort(); pageWork = new AbortController();
  const signal = pageWork.signal;
  pageNumber = number; source.value = ""; el("result").textContent = "";
  el("regions").replaceChildren(); el("sheet").hidden = true;
  el("pageNumber").textContent = number + " / " + pdf.numPages;
  el<HTMLButtonElement>("prev").disabled = number === 1;
  el<HTMLButtonElement>("next").disabled = number === pdf.numPages;
  status(t("readerLoading"));
  try {
    const page = await pdf.getPage(number);
    signal.throwIfAborted();
    const result = await renderPdf(page, signal, text => { source.value = text; void translate(); });
    if (signal.aborted) return;
    result.canvas.id = "canvas"; el("canvas").replaceWith(result.canvas);
    el("regions").replaceChildren(result.regions); el("sheet").hidden = false;
    status(t(result.hasText ? "readerPick" : "readerNoText"));
  } catch (error) { if (!signal.aborted) status(String(error)); }
}
el("prev").onclick = () => { void showPage(pageNumber - 1); };
el("next").onclick = () => { void showPage(pageNumber + 1); };

async function display(blob: Blob, isPdf: boolean, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (blob.size > (isPdf ? 100 : 24) * 1024 * 1024) throw new Error(t("readerTooLarge"));
  el("workspace").hidden = false;
  image.hidden = isPdf; el("sheet").hidden = true;
  el("ocrControls").hidden = isPdf; el("pages").hidden = !isPdf;
  if (isPdf) {
    const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
    if (signal.aborted) { void doc.loadingTask.destroy(); return; }
    pdf = doc; await showPage(1);
  } else {
    picture = blob; imageUrl = URL.createObjectURL(blob); image.src = imageUrl;
    await readImage();
  }
}

file.onchange = () => {
  const selected = file.files?.[0]; file.value = "";
  if (!selected) return;
  const signal = resetDocument();
  status(t("readerLoading"));
  void display(selected, selected.type === "application/pdf" || /\.pdf$/i.test(selected.name), signal)
    .catch(error => { if (!signal.aborted) status(String(error)); });
};

async function openUrl(raw: string, isPdf: boolean): Promise<void> {
  const signal = resetDocument();
  status(t("readerLoading"));
  try {
    const url = new URL(raw);
    if ((!/^https?:$/.test(url.protocol) && !(url.protocol === "data:" && /^data:image\//i.test(raw))) || url.username || url.password) {
      throw new Error(t("readerUseFile"));
    }
    const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal });
    if (!res.ok) throw new Error(t("readerUseFile") + " (HTTP " + res.status + ")");
    const limit = (isPdf ? 100 : 24) * 1024 * 1024;
    const reader = res.body?.getReader();
    if (!reader) throw new Error(t("readerUseFile"));
    let size = 0;
    const chunks: ArrayBuffer[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error(t("readerTooLarge")); }
      chunks.push(new Uint8Array(value).buffer);
    }
    await display(new Blob(chunks, { type: res.headers.get("content-type") || "" }), isPdf, signal);
  } catch (error) { if (!signal.aborted) status(String(error)); }
}

let slot = "", lastJob = "", selectionEpoch = 0;
interface ImageJob { id: string; url: string }
function showJob(job?: ImageJob): void {
  if (!job || job.id === lastJob) return;
  lastJob = job.id;
  if (job.url) void openUrl(job.url, false);
  else { resetDocument(); status(t("readerUseFile")); }
}

async function watchImages(): Promise<void> {
  const epoch = ++selectionEpoch;
  const explicitTab = Number(mode.get("tab"));
  const tabId = explicitTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (epoch !== selectionEpoch || !tabId) return;
  const key = "lensImage:" + tabId;
  if (key !== slot) { resetDocument(); lastJob = ""; status(t("imageStart")); }
  slot = key;
  const value = await chrome.storage.session.get(key);
  if (epoch === selectionEpoch) showJob(value[key]);
}

if (mode.get("mode") === "image" || location.pathname.endsWith("/image.html")) {
  el("title").textContent = document.title = t("imageTitle");
  file.accept = "image/*";
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes[slot]) showJob(changes[slot].newValue); });
  if (!mode.has("tab")) chrome.tabs.onActivated.addListener(() => { void watchImages(); });
  void watchImages();
} else {
  const remote = new URLSearchParams(location.hash.slice(1)).get("pdf");
  if (remote) void openUrl(remote, true);
}
window.addEventListener("pagehide", resetDocument);
