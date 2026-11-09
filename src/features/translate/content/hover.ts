import { translateText } from "@shared/translateText";
import type { Settings } from "@shared/types";
import { t } from "@shared/i18n";
import { collectUnits, shouldSkipElement } from "./paragraphGrouper";
import { isOwnUi } from "@content/selection-util";

export class HoverTranslator {
  private hovered: Element | null = null;
  private translations = new Map<Element, { node: HTMLElement; controller: AbortController }>();
  key: Settings["hoverKey"] = "off";

  private pointer = (event: PointerEvent) => {
    if (event.isTrusted) this.hovered = event.composedPath().find(item => item instanceof Element) as Element ?? null;
  };
  private leave = () => { this.hovered = null; };
  private armed = false;
  private down = (event: KeyboardEvent) => {
    if (!event.isTrusted || event.repeat) return;
    this.armed = event.key === this.key && !event.ctrlKey && !event.metaKey && !(event.altKey && event.shiftKey);
  };
  private up = (event: KeyboardEvent) => {
    if (!event.isTrusted || event.key !== this.key || !this.armed) return;
    this.armed = false;
    if (document.activeElement?.closest("input,textarea,[contenteditable]:not([contenteditable=false])")) return;
    const target = this.hovered;
    if (!target || !target.isConnected || isOwnUi(target) || shouldSkipElement(target)) return;
    const block = target.closest("p,li,blockquote,figcaption,h1,h2,h3,h4,dd,dt,div");
    if (!block) return;
    const old = this.translations.get(block);
    if (old) { old.controller.abort(); old.node.remove(); this.translations.delete(block); return; }
    const unit = collectUnits(block).find(unit => unit.block === block);
    if (!unit) return;
    event.preventDefault();
    const node = document.createElement("span");
    node.className = "lens-tr-block";
    node.dataset.lensUi = "hover";
    node.setAttribute("role", "status");
    node.textContent = t("translating");
    block.append(node);
    const controller = new AbortController();
    this.translations.set(block, { node, controller });
    void translateText(unit.text, { signal: controller.signal }).then(text => { node.textContent = text; })
      .catch(error => { if (!controller.signal.aborted) node.textContent = error.message; });
  };
  init(): void {
    document.addEventListener("pointerover", this.pointer, true);
    document.addEventListener("pointerleave", this.leave);
    document.addEventListener("keydown", this.down, true);
    document.addEventListener("keyup", this.up, true);
  }
  clear(): void {
    for (const item of this.translations.values()) { item.controller.abort(); item.node.remove(); }
    this.translations.clear();
  }
  destroy(): void {
    this.clear();
    document.removeEventListener("pointerover", this.pointer, true);
    document.removeEventListener("pointerleave", this.leave);
    document.removeEventListener("keydown", this.down, true);
    document.removeEventListener("keyup", this.up, true);
  }
}
