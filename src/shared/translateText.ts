import { t } from "./i18n";
import { SELECTION_PORT_NAME } from "./messaging";
import { nativeTranslate } from "./nativeTranslator";
import { loadSettings } from "./settings";
import type { SelectionOutbound, Settings } from "./types";

export interface TextRequest {
  targetLang?: string;
  sentence?: string;
  sourceHint?: string;
  signal?: AbortSignal;
  settings?: Pick<Settings, "engine" | "targetLang">;
  onDelta?: (chunk: string) => void;
}

export async function translateText(text: string, options: TextRequest = {}): Promise<string> {
  const settings = options.settings ?? await loadSettings();
  const { signal, sentence } = options;
  signal?.throwIfAborted();
  const target = options.targetLang || settings.targetLang;
  if (settings.engine === "chrome") {
    const hint = options.sourceHint ?? document.documentElement.lang;
    const word = await nativeTranslate(text, target, hint, signal);
    if (sentence && sentence !== text) return word + "\n" + await nativeTranslate(sentence, target, hint, signal);
    return word;
  }
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: SELECTION_PORT_NAME });
    const cleanup = () => { signal?.removeEventListener("abort", abort); port.disconnect(); };
    const abort = () => { reject(new DOMException("Aborted", "AbortError")); cleanup(); };
    port.onDisconnect.addListener(() => {
      signal?.removeEventListener("abort", abort);
      reject(new Error(chrome.runtime.lastError?.message || t("toastFailed")));
    });
    port.onMessage.addListener((message: SelectionOutbound) => {
      if (message.type === "DELTA") options.onDelta?.(message.chunk);
      if (message.type === "DONE") { resolve(message.translated); cleanup(); }
      if (message.type === "ERROR") { reject(new Error(message.message)); cleanup(); }
    });
    signal?.addEventListener("abort", abort, { once: true });
    port.postMessage({ type: "TRANSLATE", text, targetLang: target, sentence });
  });
}
