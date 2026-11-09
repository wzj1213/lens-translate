import { t } from "@shared/i18n";
import { SELECTION_PORT_NAME } from "@shared/messaging";
import type { SelectionOutbound } from "@shared/types";
import { ensureExtensionContext, formatContentError } from "@content/env";
import { showToast } from "@content/toast";

/** Translate the text in the currently focused input / textarea / contenteditable. */
export function translateFocusedInput(): void {
  const target = findEditable(document.activeElement);
  if (!target) {
    showToast(t("toastNoText"), "info", 2200);
    return;
  }
  const original = readEditable(target);
  const text = original.trim();
  if (!text) {
    showToast(t("toastNoText"), "info", 2200);
    return;
  }

  showToast(t("translating"), "info", 4000);
  let full = "";
  try {
    ensureExtensionContext();
    const port = chrome.runtime.connect({ name: SELECTION_PORT_NAME });
    port.onMessage.addListener((message: SelectionOutbound) => {
      if (message.type === "DELTA") {
        full += message.chunk;
      } else if (message.type === "DONE") {
        const translated = message.translated || full;
        if (!target.isConnected || readEditable(target) !== original) {
          showToast(t("toastInputChanged"), "info", 3000);
        } else if (translated) {
          writeEditable(target, translated);
          showToast(t("panelTranslated"), "success", 1800);
        }
        try {
          port.disconnect();
        } catch {
          /* gone */
        }
      } else if (message.type === "ERROR") {
        showToast(message.message, "error", 4000);
        try {
          port.disconnect();
        } catch {
          /* gone */
        }
      }
    });
    port.postMessage({ type: "TRANSLATE", text });
  } catch (error) {
    showToast(formatContentError(error), "error", 4000);
  }
}

function findEditable(node: Element | null): HTMLElement | null {
  if (!node) return null;
  if (node instanceof HTMLTextAreaElement) return node;
  if (node instanceof HTMLInputElement && /^(text|search|url|email|)$/i.test(node.type)) return node;
  if (node instanceof HTMLElement && node.isContentEditable) return node;
  return null;
}

function readEditable(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.textContent ?? "";
}

function writeEditable(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    // Assigning `.value` directly is invisible to React's value tracker, so the
    // framework re-renders the old text straight back. Going through the native
    // prototype setter is what makes controlled inputs actually accept the edit.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
