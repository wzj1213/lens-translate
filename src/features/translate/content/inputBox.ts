import { t } from "@shared/i18n";
import { translateText } from "@shared/translateText";
import { loadSettings } from "@shared/settings";
import { formatContentError } from "@content/env";
import { showToast } from "@content/toast";

type Edit = { original: string; translated: string; nodes?: Node[] };
const edits = new WeakMap<HTMLElement, Edit>();
const pending = new WeakMap<HTMLElement, AbortController>();

export function undoInput(): boolean {
  const el = findEditable(document.activeElement);
  if (!el) return false;
  const edit = edits.get(el);
  if (!edit || readEditable(el) !== edit.translated) return false;
  edits.delete(el);
  if (edit.nodes) {
    el.replaceChildren(...edit.nodes);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else writeEditable(el, edit.original);
  showToast(t("inputRestored"), "success", 1600);
  return true;
}

export function inputUndoKey(event: KeyboardEvent): void {
  if (event.isTrusted && event.key === "Escape" && undoInput()) event.preventDefault();
}

export async function translateFocusedInput(): Promise<void> {
  const target = findEditable(document.activeElement);
  if (!target) { showToast(t("toastNoText"), "info", 2200); return; }
  const original = readEditable(target);
  const prefix = original.match(/^\s*\/([a-z]{2,3}(?:-[a-z]{2,4})?)\s+/i);
  const text = original.slice(prefix?.[0].length ?? 0).trim();
  if (!text) { showToast(t("toastNoText"), "info", 2200); return; }

  pending.get(target)?.abort();
  const controller = new AbortController();
  pending.set(target, controller);
  showToast(t("translating"), "info", 4000);
  try {
    const settings = await loadSettings();
    const translated = await translateText(text, { settings, targetLang: prefix?.[1] || settings.writingLang,
      sourceHint: "", signal: controller.signal });
    if (controller.signal.aborted) return;
    if (!target.isConnected || readEditable(target) !== original) {
      showToast(t("toastInputChanged"), "info", 3000);
    } else if (translated) {
      edits.set(target, { original, translated, nodes: target.isContentEditable ? Array.from(target.childNodes) : undefined });
      writeEditable(target, translated);
      showToast(t("inputUndoHint"), "success", 3200);
    }
  } catch (error) {
    if (!controller.signal.aborted) showToast(formatContentError(error), "error", 4000);
  } finally {
    if (pending.get(target) === controller) pending.delete(target);
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
  return el.innerText ?? el.textContent ?? "";
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
    el.innerText = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
