import { t } from "@shared/i18n";
import type { SelectionToolbarMode } from "@shared/types";
import { getSelectionInfo, isEditableSelection, isOwnUi, positionFloating, type SelectionInfo } from "@content/selection-util";

export class SelectionBar {
  private el: HTMLElement | null = null;
  private info: SelectionInfo | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Do not flash before the first settings read finishes.
  private mode: SelectionToolbarMode = "off";

  private readonly onMouseUp = (e: Event) => {
    if (isOwnUi(e.target)) return;
    this.schedule(80);
  };
  private readonly onKeyUp = (e: Event) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Escape") return this.hide();
    if (key.startsWith("Arrow") || key === "Home" || key === "End") this.schedule(80);
  };
  private readonly onMouseDown = (e: Event) => {
    if (!isOwnUi(e.target)) this.hide();
  };
  private readonly onViewportChange = () => this.hide();

  constructor(private readonly translate: (selection: SelectionInfo) => void) {}

  setMode(mode: SelectionToolbarMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.hide();
  }

  openManually(): boolean {
    if (this.mode === "off") return false;
    // Cancel a pending automatic display so it cannot reposition this one.
    this.hide();
    return this.show(true);
  }

  init(): void {
    document.addEventListener("mouseup", this.onMouseUp, true);
    document.addEventListener("keyup", this.onKeyUp, true);
    document.addEventListener("mousedown", this.onMouseDown, true);
    window.addEventListener("scroll", this.onViewportChange, true);
    window.addEventListener("resize", this.onViewportChange);
  }

  destroy(): void {
    this.hide();
    document.removeEventListener("mouseup", this.onMouseUp, true);
    document.removeEventListener("keyup", this.onKeyUp, true);
    document.removeEventListener("mousedown", this.onMouseDown, true);
    window.removeEventListener("scroll", this.onViewportChange, true);
    window.removeEventListener("resize", this.onViewportChange);
    this.el?.remove();
    this.el = null;
  }

  hide(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.el) this.el.dataset.visible = "false";
    this.info = null;
  }

  private schedule(delay: number): void {
    if (this.mode !== "auto" || isEditableSelection()) return this.hide();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.mode === "auto" && !isEditableSelection()) this.show();
    }, delay);
  }

  private show(manual = false): boolean {
    const info = getSelectionInfo();
    if (!info) { this.hide(); return false; }
    this.info = info;
    const el = this.ensure();
    el.dataset.visible = "true";
    positionFloating(el, info.rect, { gap: 8, preferred: manual ? "below" : "above" });
    return true;
  }

  private ensure(): HTMLElement {
    if (this.el) return this.el;
    const el = document.createElement("div");
    el.className = "lens-selbar";
    el.dataset.lensUi = "selection-bar";
    el.dataset.visible = "false";
    // Keep the original selection while the user clicks the toolbar.
    el.addEventListener("mousedown", (event) => event.preventDefault());
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lens-selbar-btn";
    button.textContent = t("translateSelection");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const selection = this.info;
      this.hide();
      if (selection) this.translate(selection);
    });
    el.appendChild(button);
    document.documentElement.appendChild(el);
    this.el = el;
    return el;
  }
}

export const SELECTION_BAR_CSS = `
.lens-selbar {
  position: fixed;
  z-index: 2147483600;
  display: none;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--lens-srf);
  border: 1px solid var(--lens-line);
  border-radius: var(--lens-r-sm);
  box-shadow: var(--lens-shadow);
  font-family: var(--lens-font);
  font-size: 13px;
  line-height: 1;
  color: var(--lens-fg);
  white-space: nowrap;
  user-select: none;
}
.lens-selbar[data-visible="true"] { display: flex; }
.lens-selbar-btn {
  appearance: none;
  border: 0;
  background: none;
  color: var(--lens-fg-2);
  font: inherit;
  padding: 5px 9px;
  border-radius: 5px;
  cursor: pointer;
}
.lens-selbar-btn:hover { background: var(--lens-srf-2); color: var(--lens-fg); }
`;
