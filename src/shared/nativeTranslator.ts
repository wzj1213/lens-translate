import { bcp47For } from "./constants";
import { t } from "./i18n";

interface LanguagePair { sourceLanguage: string; targetLanguage: string }
interface BrowserTranslator { translate(text: string, options: { signal?: AbortSignal }): Promise<string> }
interface NativeApi {
  availability(pair: LanguagePair): Promise<string>;
  create(options: LanguagePair & { signal?: AbortSignal; monitor?: (monitor: EventTarget) => void }): Promise<BrowserTranslator>;
}
const ready = new Map<string, Promise<BrowserTranslator>>();

function languageTag(value: string): string {
  const tag = bcp47For(value) ?? value;
  try {
    const locale = new Intl.Locale(tag);
    if (locale.language === "zh") return locale.maximize().script === "Hant" ? "zh-Hant" : "zh";
    return locale.language;
  } catch { return ""; }
}

export async function sourceLanguage(text: string, hint = ""): Promise<string> {
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  if (/[\u4e00-\u9fff]/u.test(text)) return /^zh/i.test(hint) ? hint : "zh";
  try {
    const detected = await chrome.i18n.detectLanguage(text);
    const best = detected.languages[0];
    if (best && best.language !== "und" && (detected.isReliable || best.percentage >= 75)) return best.language;
  } catch { /* Detection is optional on older browsers. */ }
  const pageLang = languageTag(hint);
  if (/[a-z]/i.test(text) && /^(zh|ja|ko)(-|$)/i.test(pageLang)) return "en";
  return pageLang || "en";
}

function installPack(api: NativeApi, pair: LanguagePair, signal?: AbortSignal): Promise<BrowserTranslator> {
  return new Promise((resolve, reject) => {
    const panel = document.createElement("aside");
    panel.dataset.lensUi = "language-pack";
    panel.setAttribute("role", "status");
    panel.style.cssText = "position:fixed;right:16px;bottom:68px;z-index:2147483647;padding:12px;background:#fff;color:#182623;border:1px solid #bbb;border-radius:8px;font:14px system-ui;box-shadow:0 2px 12px #0002";
    const label = document.createElement("span");
    label.textContent = t("nativePack", [pair.sourceLanguage, pair.targetLanguage]) + " ";
    const download = document.createElement("button");
    download.textContent = t("nativeDownload");
    const cancel = document.createElement("button");
    cancel.textContent = t("cancelAction");
    for (const button of [download, cancel]) button.type = "button";
    const controller = new AbortController();
    const clean = () => { panel.remove(); signal?.removeEventListener("abort", abort); };
    const abort = () => { controller.abort(); clean(); reject(new DOMException(t("nativeCancelled"), "AbortError")); };
    cancel.addEventListener("click", event => { if (event.isTrusted) abort(); });
    download.addEventListener("click", event => {
      if (!event.isTrusted || download.disabled) return;
      download.disabled = true;
      label.textContent = t("nativeProgress", "0") + " ";
      api.create({ ...pair, signal: controller.signal, monitor(monitor) {
        monitor.addEventListener("downloadprogress", event => {
          label.textContent = t("nativeProgress", String(Math.round((event as ProgressEvent).loaded * 100)));
        });
      }}).then(resolve, error => {
        reject(controller.signal.aborted ? error : new Error(t("nativePackFailed")));
      }).finally(clean);
    });
    panel.append(label, download, cancel);
    document.documentElement.append(panel);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function nativeTranslate(text: string, target: string, hint = "", signal?: AbortSignal): Promise<string> {
  const api = (globalThis as unknown as { Translator?: NativeApi }).Translator;
  if (!api) throw new Error(t("nativeUnavailable"));
  const source = languageTag(await sourceLanguage(text, hint));
  const dest = languageTag(target);
  if (!source || !dest) throw new Error(t("nativePairUnavailable"));
  if (source === dest || (source.split("-")[0] === dest.split("-")[0] && !source.startsWith("zh"))) return text;
  const pair = { sourceLanguage: source, targetLanguage: dest };
  const key = JSON.stringify(pair);
  let promise = ready.get(key);
  if (!promise) {
    promise = (async () => {
      const state = await api.availability(pair);
      if (state === "unavailable") throw new Error(t("nativePairUnavailable"));
      signal?.throwIfAborted();
      return state === "available" ? api.create(pair) : installPack(api, pair, signal);
    })();
    ready.set(key, promise);
    promise.catch(() => ready.delete(key));
  }
  const translator = await promise;
  signal?.throwIfAborted();
  return translator.translate(text, { signal });
}
