import { SelectionBar, SELECTION_BAR_CSS } from "@content/selection-bar";
import { selectionModeFor } from "@shared/selectionRules";
import { SETTINGS_KEY } from "@shared/constants";
import { shouldSkipTranslation } from "@shared/langDetect";
import { loadSettings, normalizeSettings, saveSettings } from "@shared/settings";
import { isAutoOnFor, setAutoForHost } from "@shared/siteRules";
import type { ContentCommand, PageStatus, PublicSettings, Segment, Settings } from "@shared/types";
import { createId } from "@shared/util";
import { collectPrioritized } from "@features/translate/content/collect";
import { ensureExtensionContext, formatContentError, isTopFrame } from "@content/env";
import { FloatingBubble } from "@features/translate/content/bubble";
import { CaptionTranslator } from "./captions";
import { HoverTranslator } from "./hover";
import { inputUndoKey, undoInput, translateFocusedInput } from "@features/translate/content/inputBox";
import { setTranslateUiText, type ParaUnit } from "@features/translate/content/paragraphGrouper";
import { Renderer } from "@features/translate/content/render";
import { SelectionTranslator } from "@features/translate/content/selection";
import { NativePageSession } from "./nativeSession";
import { PageSession } from "@features/translate/content/session";
import { addStyles, applyTheme, injectStyles } from "@content/styles";
import { hideToast, showToast } from "@content/toast";
import { AutoTranslator, isPageVisible } from "@features/translate/content/observer";

/** Give up re-submitting segments a dying session dropped after this many tries. */
const MAX_RESUBMITS = 2;
/** Runaway guard for the whole-page sweep (20 x maxSegments ≈ 6400 paragraphs). */
const MAX_SWEEP_WAVES = 20;

/**
 * How a batch of segments was requested. "manual" is the first wave of an
 * explicit page translation, "sweep" its follow-up waves (same toasts, minus the
 * per-wave submit notice), "auto" is the scroll-driven observer.
 */
type SubmitMode = "manual" | "sweep" | "auto";

const isUserInitiated = (mode: SubmitMode): boolean => mode !== "auto";

export class TranslatorApp {
  private settings: Settings | null = null;
  private readonly renderer = new Renderer();
  private readonly captions = new CaptionTranslator();
  private readonly hover = new HoverTranslator();
  private sampleUrl = "";
  private sample = "";
  private readonly selection = new SelectionTranslator();
  private readonly bar = new SelectionBar(({ text, rect, sentence }) => this.selection.translateSelection(text, rect, sentence));
  private readonly bubble = new FloatingBubble({
    onTranslate: () => this.togglePage(),
    onToggleAuto: () => void this.toggleAuto(),
    onToggleDisplayMode: () => void this.toggleDisplayMode(),
    onDisable: () => void this.setBubbleEnabled(false),
  });
  private readonly auto = new AutoTranslator({
    batchSize: 80,
    prefetchScreens: 1,
    debounceMs: 400,
    onPass: (units) => this.translateUnits(units, "auto"),
  });

  private session: PageSession | NativePageSession | null = null;
  private sessionMode: SubmitMode = "manual";
  private busy = false;
  private autoActive = false;
  private resubmits = 0;
  /** Waves left in the current "translate this page" sweep; 0 = not sweeping. */
  private sweepWaves = 0;

  init(): Promise<void> {
    injectStyles();
    addStyles("selection-bar", SELECTION_BAR_CSS);
    this.selection.init();
    this.hover.init();
    document.addEventListener("keydown", inputUndoKey, true);
    this.bar.init();
    chrome.storage.onChanged.addListener(this.onSettingsChanged);
    window.addEventListener("pagehide", this.onPageHide, true);
    window.addEventListener("pageshow", this.onPageShow, true);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    return this.loadAndApply();
  }

  private readonly onSettingsChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === "local" && changes[SETTINGS_KEY]) void this.loadAndApply();
  };

  // On a bfcache freeze (event.persisted) the JS context survives, so we only stop
  // in-flight network work and keep all listeners/observers alive for restore.
  private readonly onPageHide = (event: PageTransitionEvent): void => {
    hideToast();
    this.session?.cancel();
    if (event.persisted) return;
    this.auto.disable();
    this.autoActive = false;
    this.bar.destroy();
    this.selection.destroy();
    this.hover.destroy();
    this.captions.stop();
    document.removeEventListener("keydown", inputUndoKey, true);
    this.bubble.unmount();
    chrome.storage.onChanged.removeListener(this.onSettingsChanged);
    window.removeEventListener("pagehide", this.onPageHide, true);
    window.removeEventListener("pageshow", this.onPageShow, true);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  };

  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) this.loadAndApply();
  };

  /**
   * Auto-translate is keyed off settings in SHARED storage, so a change made in
   * one tab reaches every other tab. Gating on visibility here is what stops a
   * background tab from translating itself the moment auto is switched on
   * somewhere else — it only starts once the user actually looks at it.
   */
  private readonly onVisibilityChange = (): void => {
    this.syncAuto();
  };

  private loadAndApply(): Promise<void> {
    return loadSettings()
      .then((settings) => this.applySettings(settings))
      .catch(() => undefined);
  }

  private applySettings(settings: Settings): void {
    if (this.settings && (settings.engine !== this.settings.engine || settings.endpoint !== this.settings.endpoint)) {
      this.stopSession();
      this.selection.cancel();
    }
    if (this.settings && (settings.engine !== this.settings.engine || settings.targetLang !== this.settings.targetLang || settings.endpoint !== this.settings.endpoint ||
        settings.model !== this.settings.model || settings.glossary !== this.settings.glossary)) {
      this.captions.stop();
      this.hover.clear();
    }
    this.settings = settings;
    this.hover.key = settings.hoverKey;
    this.bar.setMode(selectionModeFor(settings, location.href));
    applyTheme(settings.translationColor);
    setTranslateUiText(settings.translateUiText);
    this.renderer.setTargetLang(settings.targetLang);
    this.selection.setTargetLang(settings.targetLang);
    this.renderer.setDisplayMode(settings.displayMode);
    this.bubble.setDisplayMode(settings.displayMode);
    this.auto.update({
      batchSize: settings.autoTranslateBatchSize,
      prefetchScreens: settings.autoTranslatePrefetchScreens,
      debounceMs: settings.autoTranslateDebounceMs,
    });

    if (isTopFrame() && settings.floatingBubbleEnabled) this.bubble.mount();
    else this.bubble.unmount();

    this.bubble.setAutoEnabled(this.autoWanted());
    this.syncAuto();
  }

  /** Auto-translate setting for THIS host (per-site rule beats the global default). */
  private autoWanted(): boolean {
    return this.settings ? isAutoOnFor(this.settings, location.hostname) : false;
  }

  private syncAuto(): void {
    const active = this.autoWanted() && isPageVisible();
    if (active && !this.autoActive) {
      this.autoActive = true;
      this.auto.enable();
    } else if (!active && this.autoActive) {
      this.autoActive = false;
      this.auto.disable();
    }
  }

  async handleCommand(command: ContentCommand): Promise<Partial<PageStatus>> {
    switch (command) {
      case "SHOW_SELECTION_TOOLBAR": {
        // A popup can save a site rule immediately before opening the toolbar.
        const mode = selectionModeFor(await loadSettings(), location.href);
        this.bar.setMode(mode);
        if (mode === "off") throw new Error(this.text("selectionToolbarDisabled"));
        if (!this.bar.openManually()) throw new Error(this.text("toastNoText"));
        return {};
      }
      case "TOGGLE_PAGE":
        this.togglePage();
        return {};
      case "TRANSLATE_PAGE":
        this.translatePage();
        return {};
      case "TRANSLATE_SELECTION":
        if (!this.selection.translateCurrentSelection()) showToast(this.text("toastNoText"), "info", 2200);
        return {};
      case "RESTORE_ORIGINAL":
        this.restoreOriginal();
        return {};
      case "STOP_TRANSLATION":
        this.stopSession();
        showToast(this.text("toastStopped"), "info", 2500);
        return {};
      case "TOGGLE_AUTO":
        void this.toggleAuto();
        return {};
      case "TOGGLE_DISPLAY_MODE":
        void this.toggleDisplayMode();
        return {};
      case "TOGGLE_CAPTIONS":
        return { captions: this.captions.toggle() };
      case "TRANSLATE_INPUT":
        void translateFocusedInput();
        return {};
      case "UNDO_INPUT":
        undoInput();
        return {};
      case "GET_STATUS":
        return {
          active: this.renderer.size > 0,
          translated: this.renderer.size,
          busy: this.busy,
          captions: this.captions.active,
          auto: this.autoWanted(),
          displayMode: this.settings?.displayMode ?? "bilingual",
        };
      default:
        return {};
    }
  }

  private togglePage(): void {
    if (this.renderer.size > 0) this.restoreOriginal();
    else this.translatePage();
  }

  private translatePage(): void {
    const settings = this.settings;
    if (!settings) return;
    if (this.renderer.size > 0) this.restoreOriginal({ silent: true });
    // "Translate this page" means the whole page. maxSegments caps one REQUEST
    // wave, not the page: the sweep keeps going until nothing is left.
    this.sweepWaves = MAX_SWEEP_WAVES;
    const units = collectPrioritized({ limit: settings.maxSegments });
    this.translateUnits(units, "manual");
  }

  /** Queue the next wave of an explicit page translation. True if more was sent. */
  private continueSweep(): boolean {
    if (this.sweepWaves <= 0 || !isUserInitiated(this.sessionMode) || !this.settings) return false;
    this.sweepWaves -= 1;
    // Already-handled blocks carry data-lens and are skipped by the collector,
    // so each wave strictly shrinks the remaining pool and this terminates.
    const units = collectPrioritized({ limit: this.settings.maxSegments });
    if (!units.length) {
      this.sweepWaves = 0;
      return false;
    }
    return this.translateUnits(units, "sweep");
  }

  private translateUnits(units: ParaUnit[], mode: SubmitMode): boolean {
    if (!this.settings) return false;
    const settings = this.settings;

    const fresh: ParaUnit[] = [];
    for (const unit of units) {
      if (this.renderer.has(unit.block.dataset.lensId ?? "")) continue;
      if (settings.sourceSkip && shouldSkipTranslation(unit.text, settings.targetLang)) {
        unit.block.dataset.lens = "skip";
        continue;
      }
      fresh.push(unit);
    }

    if (!fresh.length) {
      if (mode === "manual") showToast(this.text("toastNoText"), "info", 2600);
      if (mode === "sweep") this.sweepWaves = 0;
      return false;
    }

    const segments: Segment[] = fresh.map((unit) => {
      const id = createId("seg");
      unit.block.dataset.lensId = id;
      this.renderer.register(id, unit);
      return { id, text: unit.text };
    });

    this.submit(segments, mode);
    return true;
  }

  /**
   * Hand segments to the background. If a run is already in flight they are
   * APPENDED to it, so newly scrolled paragraphs join the same pool of parallel
   * requests instead of queueing behind the whole previous batch.
   */
  private submit(segments: Segment[], mode: SubmitMode): void {
    try {
      ensureExtensionContext();
    } catch (error) {
      this.sweepWaves = 0;
      this.renderer.dropUnresolved();
      showToast(formatContentError(error), "error", 5000);
      return;
    }

    if (this.session?.active && this.session.append(segments)) {
      // A user action joining a scroll-driven run takes ownership of it —
      // otherwise its completion toast and page sweep would be suppressed.
      if (isUserInitiated(mode) && !isUserInitiated(this.sessionMode)) this.sessionMode = mode;
      if (mode === "manual") showToast(this.text("toastSubmitted", [String(segments.length)]), "info", 2600);
      return;
    }

    this.sessionMode = mode;
    const settings = this.settings!;
    if (this.sampleUrl !== location.href) { this.sampleUrl = location.href; this.sample = ""; }
    if (settings.consistentTerms && this.sample.length < 1600) {
      this.sample = [this.sample, ...segments.map(segment => segment.text)].filter(Boolean).join("\n").slice(0, 5500);
    }
    const Session = settings.engine === "model" ? PageSession : NativePageSession;
    this.session = new Session(this.renderer, segments, {
      onBusy: (busy) => {
        this.busy = busy;
        this.bubble.setBusy(busy);
      },
      onProgress: (p) => this.bubble.setProgress(p.completed + p.failed, p.total),
      onRetry: (msg) => {
        if (isUserInitiated(this.sessionMode)) showToast(msg, "warning", 4000);
      },
      onComplete: (result) => {
        if (this.resubmitUnresolved()) return;
        if (this.continueSweep()) return; // more of the page still to translate
        if (isUserInitiated(this.sessionMode)) {
          const tone = result.failed ? "warning" : "success";
          showToast(this.text("toastComplete", [String(result.completed), String(result.total)]), tone, 3500);
        } else if (result.failed) {
          showToast(this.text("toastComplete", [String(result.completed), String(result.total)]), "warning", 3000);
        } else {
          hideToast();
        }
        if (this.autoActive) this.auto.nudge();
      },
      onCancelled: () => {
        this.sweepWaves = 0;
        this.renderer.dropUnresolved();
        if (isUserInitiated(this.sessionMode)) showToast(this.text("toastStopped"), "info", 2500);
      },
      onDropped: () => {
        // The service worker went away mid-run; retry the leftovers once or twice
        // instead of leaving placeholders shimmering forever.
        if (!this.resubmitUnresolved()) this.renderer.dropUnresolved();
      },
      onFatal: (msg) => {
        this.sweepWaves = 0;
        this.renderer.dropUnresolved();
        showToast(msg, "error", 6000);
      },
      onSettings: (ps) => this.applyPublicSettings(ps),
    }, { targetLang: settings.targetLang, sample: settings.consistentTerms ? this.sample : "" });

    if (mode === "manual") {
      showToast(this.text("toastSubmitted", [String(segments.length)]), "info", 3000);
    }
    try {
      this.session.start();
    } catch (error) {
      this.busy = false;
      this.bubble.setBusy(false);
      this.renderer.dropUnresolved();
      showToast(formatContentError(error), "error", 5000);
    }
  }

  /** Re-open a session for anything the last one never answered. */
  private resubmitUnresolved(): boolean {
    const leftovers = this.renderer.unresolvedSegments();
    if (!leftovers.length) {
      this.resubmits = 0;
      return false;
    }
    if (this.resubmits >= MAX_RESUBMITS) {
      this.resubmits = 0;
      this.renderer.dropUnresolved();
      return false;
    }
    this.resubmits += 1;
    this.session = null;
    this.submit(leftovers, this.sessionMode);
    return true;
  }

  private applyPublicSettings(ps: PublicSettings): void {
    applyTheme(ps.translationColor);
    setTranslateUiText(ps.translateUiText);
    this.renderer.setTargetLang(ps.targetLang);
    this.selection.setTargetLang(ps.targetLang);
    this.renderer.setDisplayMode(ps.displayMode);
    this.bubble.setDisplayMode(ps.displayMode);
  }

  private restoreOriginal(options: { silent?: boolean } = {}): void {
    this.stopSession();
    this.hover.clear();
    this.renderer.restoreAll();
    document.querySelectorAll<HTMLElement>("[data-lens]").forEach((el) => {
      if (el.dataset.lensUi) return; // never strip markers off our own injected UI
      delete el.dataset.lens;
      delete el.dataset.lensId;
    });
    // The observer remembers every block it has already watched; without this,
    // restored blocks are never observed again and auto-translate goes dead on
    // this page until reload.
    this.auto.reset();
    if (!options.silent) showToast(this.text("toastRestored"), "success", 2500);
  }

  private stopSession(): void {
    this.session?.cancel();
    this.session = null;
    this.resubmits = 0;
    this.sweepWaves = 0;
    this.busy = false;
    this.bubble.setBusy(false);
    // We disconnect before the worker's SESSION_CANCELLED can arrive, so nothing
    // else would ever clear the placeholders of the paragraphs still in flight.
    this.renderer.dropUnresolved();
  }

  /**
   * Scope the switch to the site being viewed by writing a per-site rule. The
   * old behaviour flipped a single global flag, which meant turning auto on for
   * one site turned it on everywhere — and a site rule could leave the switch
   * unable to turn auto off at all.
   */
  private async toggleAuto(): Promise<void> {
    const settings = await loadSettings().catch(() => this.settings);
    if (!settings) return;
    const host = location.hostname;
    const next = !isAutoOnFor(settings, host);
    const updated = normalizeSettings({ ...settings, siteRules: setAutoForHost(settings, host, next) });
    await saveSettings(updated).catch(() => undefined);
    this.applySettings(updated);
    showToast(
      this.text(next ? "autoOnHost" : "autoOffHost", [host]),
      next ? "success" : "info",
      2600,
    );
  }

  private async toggleDisplayMode(): Promise<void> {
    const settings = await loadSettings().catch(() => this.settings);
    if (!settings) return;
    const next = settings.displayMode === "bilingual" ? "replace" : "bilingual";
    const updated = normalizeSettings({ ...settings, displayMode: next });
    await saveSettings(updated).catch(() => undefined);
    this.applySettings(updated);
    showToast(this.text(next === "bilingual" ? "displayBilingual" : "displayReplace"), "success", 2000);
  }

  private async setBubbleEnabled(enabled: boolean): Promise<void> {
    const settings = await loadSettings().catch(() => this.settings);
    if (!settings) return;
    await saveSettings(normalizeSettings({ ...settings, floatingBubbleEnabled: enabled })).catch(() => undefined);
  }

  private text(key: string, subs?: string[]): string {
    return chrome.i18n.getMessage(key, subs) || key;
  }
}
