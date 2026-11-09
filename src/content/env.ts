import { t } from "@shared/i18n";

export function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

export function extensionAlive(): boolean {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function ensureExtensionContext(): void {
  if (!extensionAlive()) throw new Error("Extension context invalidated.");
}

export function formatContentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("Extension context invalidated")) return t("toastContextInvalid");
  return message || t("toastFailed");
}
