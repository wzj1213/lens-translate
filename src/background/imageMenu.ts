import { createId } from "@shared/util";

const latest = new Map<number, string>();

// This function runs in the frame that owns the clicked image. It must be self-contained.
function pixelsFromFrame(url: string): string {
  const img = Array.from(document.images).find(image => image.currentSrc === url || image.src === url);
  if (!img?.naturalWidth || !img.naturalHeight) return "";
  const ratio = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const context = canvas.getContext("2d");
  if (!context) return "";
  try {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    return png.length <= 3_500_000 ? png : canvas.toDataURL("image/jpeg", 0.9);
  } catch { return ""; } // Cross-origin images can taint a canvas.
}

export async function openImage(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  const id = createId("image");
  latest.set(tabId, id);
  const fallback = () => chrome.tabs.create({ url: chrome.runtime.getURL("reader.html?mode=image&tab=" + tabId) });
  // Chrome requires that open() runs directly from the trusted menu event.
  const opening = typeof chrome.sidePanel?.open === "function"
    ? chrome.sidePanel.open({ tabId }).catch(fallback) : fallback();
  const original = info.srcUrl || "";
  const remote = /^https?:\/\//i.test(original) ? original : "";
  let url = original;
  try {
    if (/^(https?:|blob:)/i.test(original)) {
      const result = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [info.frameId ?? 0] }, func: pixelsFromFrame, args: [original],
      }).catch(() => []);
      url = result[0]?.result || remote;
    }
    if (!/^(https?:|data:image\/)/i.test(url) || url.length > 4_000_000) url = remote;
    if (latest.get(tabId) === id) {
      const key = "lensImage:" + tabId;
      // If another tab's captured image fills session storage, keep a small URL or file fallback.
      await chrome.storage.session.set({ [key]: { id, url } }).catch(() =>
        latest.get(tabId) === id ? chrome.storage.session.set({ [key]: { id, url: remote } }) : undefined);
    }
    await opening;
  } finally {
    if (latest.get(tabId) === id) latest.delete(tabId);
  }
}
