import { collectUnits, type ParaUnit } from "@features/translate/content/paragraphGrouper";

export interface CollectOptions {
  limit: number;
  viewportOnly?: boolean;
  marginTop?: number;
  marginBottom?: number;
}

function firstRect(unit: ParaUnit): DOMRect | null {
  for (const node of unit.nodes) {
    const range = document.createRange();
    try {
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) return rect as DOMRect;
      }
    } catch {
      /* detached node */
    } finally {
      range.detach();
    }
  }
  try {
    return unit.block.getBoundingClientRect();
  } catch {
    return null;
  }
}

function priorityScore(rect: DOMRect | null): number {
  if (!rect) return Number.MAX_SAFE_INTEGER;
  const inView = rect.bottom >= 0 && rect.top <= window.innerHeight;
  return (inView ? 0 : 100000) + Math.abs(rect.top);
}

function inViewport(rect: DOMRect | null, marginTop: number, marginBottom: number): boolean {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.bottom >= -marginTop &&
    rect.top <= window.innerHeight + marginBottom &&
    rect.right >= -160 &&
    rect.left <= window.innerWidth + 160
  );
}

/** Collect units, viewport-first, capped at `limit`. */
export function collectPrioritized(options: CollectOptions): ParaUnit[] {
  const marginTop = options.marginTop ?? 160;
  const marginBottom = options.marginBottom ?? 160;
  const scored = collectUnits(document.body).map((unit) => {
    const rect = firstRect(unit);
    return { unit, rect, visible: options.viewportOnly ? inViewport(rect, marginTop, marginBottom) : true };
  });

  let pool = scored;
  if (options.viewportOnly) {
    const visible = scored.filter((entry) => entry.visible);
    if (visible.length) pool = visible;
  }
  pool.sort((a, b) => priorityScore(a.rect) - priorityScore(b.rect));
  return pool.slice(0, options.limit).map((entry) => entry.unit);
}
