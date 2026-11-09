import { normalizeText } from "@shared/util";

export interface SelectionInfo {
  text: string;
  rect: DOMRect;
}

/** Text selected inside an extension control belongs to the control. */
export function isOwnUi(target: EventTarget | Node | null): boolean {
  const node = target as Node | null;
  if (!node) return false;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(el?.closest?.("[data-lens-ui]"));
}

/** Automatic selection UI should not compete with an editor's own controls. */
export function isEditableSelection(): boolean {
  if (document.designMode?.toLowerCase() === "on") return true;
  const selection = window.getSelection();
  return [selection?.anchorNode, selection?.focusNode].some((node) => {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
    if (el?.closest("input, textarea")) return true;
    const editable = el?.closest("[contenteditable]")?.getAttribute("contenteditable")?.toLowerCase();
    return editable === "" || editable === "true" || editable === "plaintext-only";
  });
}

export function getSelectionInfo(): SelectionInfo | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = normalizeText(selection.toString());
  if (text.length < 1 || text.length > 8000) return null;
  if (isOwnUi(selection.anchorNode) || isOwnUi(selection.focusNode)) return null;

  const range = selection.getRangeAt(0);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  const rect = (rects[rects.length - 1] ?? range.getBoundingClientRect()) as DOMRect;
  if (!rect || rect.width === 0 || rect.height === 0) return null;
  return { text, rect };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function positionFloating(
  element: HTMLElement,
  rect: DOMRect,
  options: { gap: number; preferred: "above" | "below" },
): void {
  const gap = options.gap;
  const width = element.offsetWidth || 320;
  const height = element.offsetHeight || 120;
  const minEdge = 10;
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    minEdge,
    Math.max(minEdge, window.innerWidth - width - minEdge),
  );
  const below = rect.bottom + gap;
  const above = rect.top - height - gap;
  const fitsBelow = below + height <= window.innerHeight - minEdge;
  const fitsAbove = above >= minEdge;
  let top = options.preferred === "above" && fitsAbove ? above : below;
  if (!fitsBelow && fitsAbove) top = above;
  top = clamp(top, minEdge, Math.max(minEdge, window.innerHeight - height - minEdge));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}
