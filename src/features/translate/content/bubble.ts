import { t } from "@shared/i18n";
import type { DisplayMode } from "@shared/types";
import { injectStyles } from "@content/styles";
import { onUserClick } from "@content/env";

export interface BubbleHandlers {
  onTranslate(): void;
  onToggleAuto(): void;
  onToggleDisplayMode(): void;
  onDisable(): void;
}

const POSITION_KEY = "lensBubblePos";
/** Pointer travel (px) past which a press becomes a drag instead of a click. */
const DRAG_THRESHOLD = 5;
const EDGE_MARGIN = 8;
/** Headroom the action menu needs above the FAB before it flips below. */
const MENU_HEADROOM = 130;

interface Point {
  x: number;
  y: number;
}

/** The bottom-right floating action button: translate, auto-translate, disable — and draggable. */
export class FloatingBubble {
  private wrap: HTMLElement | null = null;
  private main: HTMLButtonElement | null = null;
  private autoBtn: HTMLButtonElement | null = null;
  private modeBtn: HTMLButtonElement | null = null;
  private autoEnabled = false;
  private displayMode: DisplayMode = "bilingual";
  private busy = false;
  private closeTimer: number | null = null;

  // Drag state.
  private pos: Point | null = null;
  private dragging = false;
  private suppressClick = false;
  private pointerStart: Point | null = null;
  private originStart: Point | null = null;

  constructor(private readonly handlers: BubbleHandlers) {}

  mount(): void {
    if (this.wrap || !document.documentElement) return;
    injectStyles();

    const wrap = document.createElement("div");
    wrap.className = "lens-bubble-wrap";
    wrap.dataset.lensUi = "bubble";
    wrap.dataset.open = "false";

    // Secondary actions live above the main button and reveal on hover/focus.
    const actions = document.createElement("div");
    actions.className = "lens-actions";

    const autoBtn = miniButton("lens-auto", "A", t("bubbleAuto"), t("autoTranslate"));
    const modeBtn = miniButton("lens-mode", "双", t("bubbleMode"), t("labelDisplayMode"));
    const closeBtn = miniButton("lens-close", "✕", t("bubbleClose"), t("disableBubble"));
    actions.append(autoBtn, modeBtn, closeBtn);

    const main = document.createElement("button");
    main.type = "button";
    main.className = "lens-bubble";
    main.dataset.busy = "false";
    main.setAttribute("aria-label", t("translatePage"));
    main.title = t("translatePage");
    const label = document.createElement("span");
    label.textContent = t("badge");
    main.appendChild(label);

    onUserClick(main, () => {
      // Swallow the click synthesized at the end of a drag gesture.
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      this.handlers.onTranslate();
    });
    onUserClick(autoBtn, () => this.handlers.onToggleAuto());
    onUserClick(modeBtn, () => this.handlers.onToggleDisplayMode());
    onUserClick(closeBtn, () => this.handlers.onDisable());

    this.attachDrag(main);

    // Open on hover of either the main button or the (revealed) actions; a short
    // close delay bridges the gap between them so the menu doesn't flicker shut.
    const open = () => {
      if (this.dragging) return;
      if (this.closeTimer !== null) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      this.updateMenuPlacement();
      wrap.dataset.open = "true";
    };
    const scheduleClose = () => {
      if (this.closeTimer !== null) clearTimeout(this.closeTimer);
      this.closeTimer = window.setTimeout(() => {
        this.closeTimer = null;
        if (this.wrap) this.wrap.dataset.open = "false";
      }, 160);
    };
    for (const el of [main, actions]) {
      el.addEventListener("mouseenter", open);
      el.addEventListener("mouseleave", scheduleClose);
    }

    wrap.append(actions, main);
    document.documentElement.appendChild(wrap);
    this.wrap = wrap;
    this.main = main;
    this.autoBtn = autoBtn;
    this.modeBtn = modeBtn;

    window.addEventListener("resize", this.onResize);
    this.updateMenuPlacement();
    this.restorePosition();
    this.refresh();
  }

  unmount(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    window.removeEventListener("resize", this.onResize);
    this.wrap?.remove();
    this.wrap = null;
    this.main = null;
    this.autoBtn = null;
    this.modeBtn = null;
    this.dragging = false;
  }

  get mounted(): boolean {
    return Boolean(this.wrap);
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    if (this.main) {
      this.main.dataset.busy = busy ? "true" : "false";
      this.main.setAttribute("aria-busy", busy ? "true" : "false");
      if (!busy) {
        this.main.style.removeProperty("--lens-progress");
        this.main.title = t("translatePage"); // clear a stale "翻译中 3/40" tooltip
      }
    }
  }

  /** Paint run progress as a hairline fill on the FAB (replaces toast spam). */
  setProgress(done: number, total: number): void {
    if (!this.main) return;
    const pct = total > 0 ? Math.max(2, Math.min(100, Math.round((done / total) * 100))) : 0;
    this.main.style.setProperty("--lens-progress", `${pct}%`);
    this.main.title = total > 0 && done < total ? `${t("translating")} ${done}/${total}` : t("translatePage");
  }

  setAutoEnabled(enabled: boolean): void {
    this.autoEnabled = enabled;
    this.refresh();
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.refresh();
  }

  // --- Dragging -------------------------------------------------------------

  private attachDrag(main: HTMLButtonElement): void {
    main.addEventListener("pointerdown", (e) => {
      if (!e.isTrusted || e.button !== 0 || !this.wrap) return;
      this.suppressClick = false;
      this.pointerStart = { x: e.clientX, y: e.clientY };
      const rect = this.wrap.getBoundingClientRect();
      this.originStart = { x: rect.left, y: rect.top };
      try {
        main.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported */
      }
    });

    main.addEventListener("pointermove", (e) => {
      if (!e.isTrusted || !this.pointerStart || !this.originStart) return;
      const dx = e.clientX - this.pointerStart.x;
      const dy = e.clientY - this.pointerStart.y;
      if (!this.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      e.preventDefault();
      if (!this.dragging) this.beginDrag();
      this.setPosition(this.originStart.x + dx, this.originStart.y + dy);
    });

    const end = (e: PointerEvent) => {
      if (!e.isTrusted || !this.pointerStart) return;
      try {
        main.releasePointerCapture(e.pointerId);
      } catch {
        /* nothing to release */
      }
      this.pointerStart = null;
      this.originStart = null;
      if (this.dragging) {
        this.endDrag();
        this.suppressClick = true;
        // Belt-and-suspenders: if no click follows (some engines skip it after a
        // drag), don't leave the next real click suppressed.
        setTimeout(() => (this.suppressClick = false), 0);
        this.persistPosition();
      }
    };
    main.addEventListener("pointerup", end);
    main.addEventListener("pointercancel", end);
  }

  private beginDrag(): void {
    this.dragging = true;
    if (this.wrap) {
      this.wrap.dataset.dragging = "true";
      this.wrap.dataset.open = "false";
    }
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private endDrag(): void {
    this.dragging = false;
    if (this.wrap) delete this.wrap.dataset.dragging;
    // Drop focus so :focus-within doesn't immediately re-open the menu at the drop spot.
    this.main?.blur();
  }

  /** Move the wrap to viewport coords (clamped), switching off the corner anchor. */
  private setPosition(x: number, y: number): void {
    if (!this.wrap) return;
    const size = this.wrap.offsetWidth || 38;
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - size - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - size - EDGE_MARGIN);
    const cx = clamp(x, EDGE_MARGIN, maxX);
    const cy = clamp(y, EDGE_MARGIN, maxY);
    this.wrap.style.left = `${cx}px`;
    this.wrap.style.top = `${cy}px`;
    this.wrap.style.right = "auto";
    this.wrap.style.bottom = "auto";
    this.pos = { x: cx, y: cy };
    this.updateMenuPlacement();
  }

  /** Decide which way the action menu opens so it stays on-screen. */
  private updateMenuPlacement(): void {
    if (!this.wrap) return;
    const rect = this.wrap.getBoundingClientRect();
    this.wrap.dataset.flip = rect.top < MENU_HEADROOM ? "down" : "up";
    this.wrap.dataset.side = rect.left + rect.width / 2 > window.innerWidth / 2 ? "right" : "left";
  }

  private restorePosition(): void {
    try {
      void chrome.storage.local.get(POSITION_KEY).then((stored) => {
        const pos = stored?.[POSITION_KEY] as Point | undefined;
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && this.wrap) {
          this.setPosition(pos.x, pos.y);
        }
      });
    } catch {
      /* extension context torn down */
    }
  }

  private persistPosition(): void {
    if (!this.pos) return;
    try {
      void chrome.storage.local.set({ [POSITION_KEY]: this.pos });
    } catch {
      /* extension context torn down */
    }
  }

  private readonly onResize = (): void => {
    // Keep a custom position on-screen after viewport changes; refresh flip side.
    if (this.pos) this.setPosition(this.pos.x, this.pos.y);
    else this.updateMenuPlacement();
  };

  private refresh(): void {
    if (this.autoBtn) {
      this.autoBtn.dataset.enabled = this.autoEnabled ? "true" : "false";
      this.autoBtn.setAttribute("aria-pressed", this.autoEnabled ? "true" : "false");
      this.autoBtn.title = this.autoEnabled ? t("autoOff") : t("autoOn");
      setLabel(this.autoBtn, t("bubbleAuto"), this.autoEnabled ? t("stateOn") : t("stateOff"));
    }
    if (this.modeBtn) {
      const bilingual = this.displayMode === "bilingual";
      this.modeBtn.dataset.mode = this.displayMode;
      const label = bilingual ? t("displayBilingual") : t("displayReplace");
      this.modeBtn.title = label;
      this.modeBtn.setAttribute("aria-label", label);
      setIcon(this.modeBtn, bilingual ? "双" : "单");
      setLabel(this.modeBtn, t("bubbleMode"), bilingual ? t("modeShortBilingual") : t("modeShortReplace"));
    }
    if (this.main) this.main.dataset.busy = this.busy ? "true" : "false";
  }
}

function miniButton(extraClass: string, icon: string, label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `lens-mini ${extraClass}`;
  button.title = title;
  button.setAttribute("aria-label", title);
  const iconEl = document.createElement("span");
  iconEl.className = "lens-mini-icon";
  iconEl.textContent = icon;
  const labelEl = document.createElement("span");
  labelEl.className = "lens-mini-label";
  labelEl.textContent = label;
  button.append(iconEl, labelEl);
  return button;
}

function setIcon(button: HTMLButtonElement, icon: string): void {
  const el = button.querySelector<HTMLElement>(".lens-mini-icon");
  if (el) el.textContent = icon;
}

/** Chip copy is "<what> · <current state>" so the menu reads without hovering. */
function setLabel(button: HTMLButtonElement, name: string, state: string): void {
  const el = button.querySelector<HTMLElement>(".lens-mini-label");
  if (el) el.textContent = `${name} · ${state}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
