import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { t } from "@shared/i18n";

export interface TextBox { text: string; x: number; y: number; w: number; h: number }
export function paragraphs(boxes: TextBox[]): TextBox[] {
  const groups: TextBox[] = [];
  let last: TextBox | undefined;
  for (const box of boxes) {
    const group = groups.at(-1);
    const sameLine = last && Math.abs(box.y - last.y) < Math.min(box.h, last.h) * 0.5 &&
      box.x >= last.x - box.h && box.x - (last.x + last.w) < 3 * box.h;
    const nextLine = group && last && box.y > last.y + last.h * 0.4 && box.y - last.y < last.h * 1.65 &&
      Math.abs(box.x - group.x) < 2 * box.h && Math.abs(box.h - last.h) < box.h * .25;
    if (group && (sameLine || nextLine) && group.text.length + box.text.length < 2200) {
      const right = Math.max(group.x + group.w, box.x + box.w);
      const bottom = Math.max(group.y + group.h, box.y + box.h);
      group.x = Math.min(group.x, box.x); group.y = Math.min(group.y, box.y);
      group.w = right - group.x; group.h = bottom - group.y;
      group.text += " " + box.text;
    } else groups.push({ ...box });
    last = box;
  }
  return groups;
}

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const base = chrome.runtime.getURL("vendor/pdf/");
  const pdf = await import(base + "pdf.mjs") as typeof import("pdfjs-dist");
  pdf.GlobalWorkerOptions.workerSrc = base + "pdf.worker.mjs";
  return pdf.getDocument({ data, cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/",
    iccUrl: base + "iccs/", disableWorkerRendering: true, wasmUrl: base + "wasm/", useSystemFonts: true, enableXfa: false, stopAtErrors: false }).promise;
}

export async function renderPdf(page: PDFPageProxy, signal: AbortSignal, select: (text: string) => void) {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1700 / Math.max(viewport.width, viewport.height));
  const canvas = document.createElement("canvas");
  const pixels = page.getViewport({ scale });
  canvas.width = Math.ceil(pixels.width); canvas.height = Math.ceil(pixels.height);
  const task = page.render({ canvas, viewport: pixels });
  const cancel = () => task.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const [, content] = await Promise.all([task.promise, page.getTextContent()]);
    signal.throwIfAborted();
    const boxes: TextBox[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , , x, y] = item.transform;
      const [x1, y1] = viewport.convertToViewportPoint(x, y - item.height * .2);
      const [x2, y2] = viewport.convertToViewportPoint(x + item.width, y + item.height * .85);
      boxes.push({ text: item.str, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2-x1), h: Math.abs(y2-y1) });
    }
    const regions = document.createDocumentFragment();
    const groups = paragraphs(boxes);
    for (const block of groups) {
      const button = document.createElement("button");
      button.className = "region"; button.type = "button";
      button.setAttribute("aria-label", t("readerTranslate") + " · " + block.text.slice(0, 100));
      button.style.left = 100 * block.x / viewport.width + "%";
      button.style.top = 100 * block.y / viewport.height + "%";
      button.style.width = 100 * block.w / viewport.width + "%";
      button.style.height = 100 * block.h / viewport.height + "%";
      button.addEventListener("click", () => {
        button.parentElement?.querySelector('[aria-pressed="true"]')?.removeAttribute("aria-pressed");
        button.setAttribute("aria-pressed", "true"); select(block.text);
      });
      regions.append(button);
    }
    return { canvas, regions, hasText: groups.length > 0 };
  } finally { signal.removeEventListener("abort", cancel); }
}
