import { bcp47For } from "@shared/constants";
import { t } from "@shared/i18n";
import { translateText } from "@shared/translateText";
import { formatContentError, onUserClick } from "@content/env";
import { injectStyles } from "@content/styles";
import { getSelectionInfo, positionFloating } from "@content/selection-util";

export class SelectionTranslator {
  private panel: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private controller: AbortController | null = null;
  private sentence?: string;
  private requestId = 0;
  private selectionText = "";
  private anchorRect: DOMRect | null = null;
  private streamed = "";
  private langTag: string | null = null;

  private readonly onKeyDown = (e: Event) => this.onKeyDown_(e as KeyboardEvent);

  init(): void {
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  /** Voice/lang hint for reading the translation aloud. */
  setTargetLang(lang: string): void {
    this.langTag = bcp47For(lang);
  }

  cancel(): void { this.closePanel(); }

  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.disconnectPort();
    this.closePanel();
  }

  /** 工具条里的「翻译」动作，以及右键菜单 / 快捷键，都走这里 */
  translateSelection(text: string, rect: DOMRect, sentence?: string): void {
    if (!text) return;
    this.selectionText = text;
    this.sentence = sentence;
    this.anchorRect = rect;
    this.openAndTranslate();
  }

  /** Triggered by the context menu / keyboard shortcut. */
  translateCurrentSelection(): boolean {
    const info = getSelectionInfo();
    if (!info) return false;
    this.translateSelection(info.text, info.rect, info.sentence);
    return true;
  }

  private onKeyDown_(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !this.panel) return;
    this.closePanel();
  }

  private openAndTranslate(): void {
    const text = this.selectionText;
    const rect = this.anchorRect;
    if (!text || !rect) return;
    this.renderPanel(rect, text, "loading");

    const requestId = ++this.requestId;
    this.streamed = "";
    const controller = new AbortController();
    this.controller = controller;
    void translateText(text, { sentence: this.sentence, signal: controller.signal, onDelta: chunk => {
      if (this.requestId !== requestId) return;
      this.streamed += chunk;
      this.setResult(this.streamed, "result");
    }}).then(translated => {
      if (this.requestId !== requestId) return;
      this.setResult(translated, "result");
      if (this.footerEl) this.footerEl.textContent = t("panelTranslated");
    }).catch(error => {
      if (!controller.signal.aborted && this.requestId === requestId) this.setResult(formatContentError(error), "error");
    });
  }

  private renderPanel(rect: DOMRect, sourceText: string, state: "loading" | "result"): void {
    this.closePanel();
    injectStyles();

    const panel = document.createElement("section");
    panel.className = "lens-panel";
    panel.dataset.lensUi = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("panelTitle"));
    panel.addEventListener("mousedown", (e) => e.stopPropagation());

    const header = document.createElement("div");
    header.className = "lens-panel-header";
    const title = document.createElement("div");
    title.className = "lens-panel-title";
    title.textContent = t("panelTitle");
    const actions = document.createElement("div");
    actions.className = "lens-panel-actions";

    const speakBtn = iconButton(t("panelSpeak"), () => this.speak());
    const copyBtn = iconButton(t("panelCopy"), () => this.copyResult(copyBtn));
    const closeBtn = iconButton(t("panelClose"), () => this.closePanel());
    actions.append(speakBtn, copyBtn, closeBtn);
    header.append(title, actions);

    const body = document.createElement("div");
    body.className = "lens-panel-body";
    const source = document.createElement("div");
    source.className = "lens-panel-source";
    source.textContent = sourceText;
    const result = document.createElement("div");
    result.className = "lens-panel-result is-loading";
    result.textContent = t("panelTranslating");
    body.append(source, result);

    const footer = document.createElement("div");
    footer.className = "lens-panel-footer";
    footer.textContent = state === "loading" ? t("appName") : t("panelTranslated");

    panel.append(header, body, footer);
    document.documentElement.appendChild(panel);
    this.panel = panel;
    this.resultEl = result;
    this.footerEl = footer;

    requestAnimationFrame(() => {
      positionFloating(panel, rect, { gap: 10, preferred: "below" });
      panel.dataset.visible = "true";
    });
  }

  private setResult(text: string, state: "result" | "error"): void {
    if (!this.resultEl) return;
    this.resultEl.classList.remove("is-loading", "is-error");
    if (state === "error") this.resultEl.classList.add("is-error");
    this.resultEl.textContent = text;
  }

  private copyResult(button: HTMLButtonElement): void {
    const text = this.resultEl?.textContent ?? "";
    if (!text) return;
    void copyToClipboard(text).then((ok) => {
      button.textContent = ok ? "✓" : t("panelCopy");
      setTimeout(() => (button.textContent = t("panelCopy")), 1400);
    });
  }

  private speak(): void {
    const text = this.resultEl?.textContent ?? "";
    if (!text || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    // Without a lang hint the browser reads the translation with the page's
    // voice — Chinese spelled out by an English voice, for example.
    if (this.langTag) utterance.lang = this.langTag;
    window.speechSynthesis.speak(utterance);
  }

  private closePanel(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* not available */
    }
    this.disconnectPort();
    this.panel?.remove();
    this.panel = null;
    this.resultEl = null;
    this.footerEl = null;
  }

  private disconnectPort(): void {
    this.requestId++;
    this.controller?.abort();
    this.controller = null;
  }
}

function iconButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lens-icon-btn";
  button.textContent = label;
  button.title = label;
  onUserClick(button, onClick);
  return button;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.dataset.lensUi = "clip";
    document.documentElement.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
