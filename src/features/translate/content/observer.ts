import { collectPrioritized } from "@features/translate/content/collect";
import { collectUnits, collectUnitsIn, type ParaUnit } from "@features/translate/content/paragraphGrouper";

export interface AutoTranslatorOptions {
  batchSize: number;
  prefetchScreens: number;
  debounceMs: number;
  onPass: (units: ParaUnit[]) => void;
}

/** Hard ceiling on the debounce: a pass always runs within this window. */
const MAX_WAIT_MS = 900;
const RESCAN_DELAY_MS = 400;
/** Past this many freshly-added subtrees a single full scan is the cheaper option. */
const MAX_MUTATION_ROOTS = 40;

/**
 * Auto-translate must never run in a tab the user is not looking at: settings
 * live in shared storage, so without this every open tab would start translating
 * the moment auto is switched on anywhere.
 */
export function isPageVisible(): boolean {
  return document.visibilityState === "visible";
}

/**
 * Drives automatic translation as the user scrolls (IntersectionObserver) and as
 * SPA / infinite-scroll content arrives (MutationObserver). Translated blocks are
 * marked with data-lens and skipped by the grouper, so they are never re-observed.
 *
 * Passes are driven by what the observers actually reported — the blocks that
 * entered the viewport, the subtrees that were just added — rather than by
 * re-scanning the whole document each time.
 */
export class AutoTranslator {
  private io: IntersectionObserver | null = null;
  private mo: MutationObserver | null = null;
  private observed = new WeakSet<Element>();
  private enabled = false;
  private passTimer: ReturnType<typeof setTimeout> | null = null;
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private options: AutoTranslatorOptions;

  /** Blocks that scrolled into range and are waiting to be translated. */
  private ready = new Set<HTMLElement>();
  /** Subtrees added to the page since the last rescan. */
  private addedRoots = new Set<Element>();
  private fullRescan = false;
  private firstPassDone = false;
  private passDeadline = 0;

  constructor(options: AutoTranslatorOptions) {
    this.options = options;
  }

  update(options: Partial<AutoTranslatorOptions>): void {
    this.options = { ...this.options, ...options };
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    const prefetch = Math.max(120, Math.round(window.innerHeight * this.options.prefetchScreens));
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), {
      rootMargin: `${Math.min(300, Math.round(window.innerHeight * 0.4))}px 0px ${prefetch}px 0px`,
    });
    this.observeAll();
    this.mo = new MutationObserver((mutations) => this.onMutate(mutations));
    this.mo.observe(document.body, { childList: true, subtree: true });
    this.schedulePass(Math.min(650, this.options.debounceMs + 200));
  }

  disable(): void {
    this.enabled = false;
    this.io?.disconnect();
    this.mo?.disconnect();
    this.io = null;
    this.mo = null;
    this.observed = new WeakSet<Element>();
    this.ready.clear();
    this.addedRoots.clear();
    this.fullRescan = false;
    if (this.passTimer) clearTimeout(this.passTimer);
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.passTimer = null;
    this.rescanTimer = null;
    this.passDeadline = 0;
  }

  /**
   * Forget which blocks have already been watched. Required after "restore
   * original", which strips the data-lens markers — without it every restored
   * block stays in `observed` and auto-translate is dead until a reload.
   */
  reset(): void {
    this.observed = new WeakSet<Element>();
    this.ready.clear();
    this.firstPassDone = false;
    if (!this.enabled) return;
    this.observeAll();
    this.schedulePass(this.options.debounceMs);
  }

  /** Ask for another pass soon (e.g. after a session completes). */
  nudge(delay = 200): void {
    if (this.enabled) this.schedulePass(delay);
  }

  // --- Observation ----------------------------------------------------------

  private observeAll(): void {
    this.observeUnits(collectUnits(document.body));
  }

  private observeUnits(units: ParaUnit[]): void {
    if (!this.io) return;
    for (const unit of units) {
      const block = unit.block;
      if (this.observed.has(block) || block.dataset.lens) continue;
      this.observed.add(block);
      this.io.observe(block);
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    let added = false;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      this.io?.unobserve(entry.target);
      if (entry.target instanceof HTMLElement) {
        this.ready.add(entry.target);
        added = true;
      }
    }
    if (added) this.schedulePass(this.options.debounceMs);
  }

  private onMutate(mutations: MutationRecord[]): void {
    let relevant = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as Element;
        if (isOwnUi(element)) continue;
        relevant = true;
        if (this.addedRoots.size >= MAX_MUTATION_ROOTS) this.fullRescan = true;
        else this.addedRoots.add(element);
      }
    }
    if (relevant) this.scheduleRescan();
  }

  private scheduleRescan(): void {
    if (this.rescanTimer) return;
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null;
      if (!this.enabled) return;
      this.observeAdded();
      this.schedulePass(this.options.debounceMs);
    }, RESCAN_DELAY_MS);
  }

  private observeAdded(): void {
    if (this.fullRescan) {
      this.fullRescan = false;
      this.addedRoots.clear();
      this.observeAll();
      return;
    }
    if (!this.addedRoots.size) return;
    const roots = [...this.addedRoots].filter((el) => el.isConnected);
    this.addedRoots.clear();
    if (roots.length) this.observeUnits(collectUnitsIn(roots));
  }

  // --- Passes ---------------------------------------------------------------

  /**
   * Debounce with a hard deadline. A plain debounce never fires while the user
   * keeps scrolling, so a long scroll used to translate nothing until it stopped.
   */
  private schedulePass(delay: number): void {
    const now = Date.now();
    if (!this.passDeadline) this.passDeadline = now + MAX_WAIT_MS;
    const wait = Math.max(0, Math.min(delay, this.passDeadline - now));
    if (this.passTimer) clearTimeout(this.passTimer);
    this.passTimer = setTimeout(() => {
      this.passTimer = null;
      this.passDeadline = 0;
      this.runPass();
    }, wait);
  }

  private runPass(): void {
    if (!this.enabled) return;
    // Backstop: a pass timer scheduled while visible must not fire after the
    // user switched away (the tab may also have been restored from bfcache).
    if (!isPageVisible()) return;

    const limit = Math.max(1, this.options.batchSize);
    let units = this.unitsFromReady();
    if (!units.length && !this.firstPassDone) {
      // Fallback for the very first pass (and for layouts where the
      // IntersectionObserver reports nothing): one viewport-first full scan.
      units = collectPrioritized({
        limit,
        viewportOnly: true,
        marginTop: Math.min(300, Math.round(window.innerHeight * 0.4)),
        marginBottom: Math.max(220, Math.round(window.innerHeight * this.options.prefetchScreens)),
      });
    }
    this.firstPassDone = true;
    if (!units.length) return;

    // Anything over the batch cap stays queued instead of being dropped.
    if (units.length > limit) {
      for (const unit of units.slice(limit)) this.ready.add(unit.block);
      this.schedulePass(150);
      units = units.slice(0, limit);
    }
    this.options.onPass(units);
  }

  private unitsFromReady(): ParaUnit[] {
    if (!this.ready.size) return [];
    const roots = [...this.ready].filter((block) => block.isConnected && !block.dataset.lens);
    this.ready.clear();
    if (!roots.length) return [];
    const units = collectUnitsIn(roots);
    // Viewport-first: closest to the top of the screen gets translated first.
    return units
      .map((unit) => ({ unit, top: distanceFromViewport(unit.block) }))
      .sort((a, b) => a.top - b.top)
      .map((entry) => entry.unit);
  }
}

function distanceFromViewport(block: HTMLElement): number {
  try {
    const rect = block.getBoundingClientRect();
    const inView = rect.bottom >= 0 && rect.top <= window.innerHeight;
    return (inView ? 0 : 100000) + Math.abs(rect.top);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function isOwnUi(element: Element): boolean {
  return element instanceof HTMLElement && Boolean(element.dataset.lens || element.dataset.lensUi);
}
