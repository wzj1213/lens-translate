import { bcp47For } from "@shared/constants";
import { t } from "@shared/i18n";
import type { DisplayMode, Segment } from "@shared/types";
import { normalizeText } from "@shared/util";
import type { ParaUnit, RenderMode } from "@features/translate/content/paragraphGrouper";

/** Source and translation are effectively identical (ignoring case/whitespace). */
function isSameText(a: string, b: string): boolean {
  return normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();
}

interface RenderRecord {
  id: string;
  unit: ParaUnit;
  mode: RenderMode;
  tr: HTMLElement | null;
  applied: boolean;
  attrHandled: boolean;
  titleAdded: boolean;
  originalTitle: string | null;
  ariaAdded: boolean;
  originalAria: string | null;
  originalValues: string[] | null;
  /** Element we added a `title` to in swap mode (null when the page had one). */
  titleEl: HTMLElement | null;
  /** Cached so a display-mode switch can re-render without another API round-trip. */
  translated: string | null;
  failed: boolean;
}

/** Owns the page mutations for translation and can faithfully restore the DOM. */
export class Renderer {
  private records = new Map<string, RenderRecord>();
  private displayMode: DisplayMode = "bilingual";
  private langTag: string | null = null;
  appliedCount = 0;

  /** Switch bilingual <-> translation-only in place, without re-translating. */
  setDisplayMode(mode: DisplayMode): void {
    if (mode === this.displayMode) return;
    this.displayMode = mode;
    for (const record of this.records.values()) {
      // "swap" is always replaced in place — the bilingual/translation-only
      // choice does not apply to page chrome.
      if (record.mode === "attribute" || record.mode === "swap" || !record.translated) continue;
      // No injected line (the model returned the source unchanged, or the block
      // left the DOM): hiding the source here would blank the paragraph outright.
      const tr = record.tr;
      if (!tr) continue;
      if (mode === "replace") this.hideSource(record);
      else this.showSource(record);
      tr.className = this.trClass(record.mode);
      if (record.failed) tr.classList.add("lens-error");
    }
  }

  setTargetLang(lang: string): void {
    this.langTag = bcp47For(lang);
  }

  get size(): number {
    return this.records.size;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  register(id: string, unit: ParaUnit): void {
    const record: RenderRecord = {
      id,
      unit,
      mode: unit.renderMode,
      tr: null,
      applied: false,
      attrHandled: false,
      titleAdded: false,
      originalTitle: null,
      ariaAdded: false,
      originalAria: null,
      originalValues: null,
      titleEl: null,
      translated: null,
      failed: false,
    };

    if (unit.renderMode === "attribute") {
      unit.block.dataset.lens = "attr";
    } else if (unit.renderMode === "swap") {
      // No placeholder for chrome: a shimmer inside a nav row would make the
      // whole bar jitter while the batch is in flight.
      unit.block.dataset.lens = "swap";
    } else {
      unit.block.dataset.lens = "1";
      const tr = this.createTr(unit.renderMode);
      tr.classList.add("lens-pending");
      tr.setAttribute("aria-busy", "true");
      tr.setAttribute("aria-label", t("labelPending"));
      // No text: the placeholder is a CSS shimmer sized like one line, so the
      // real translation drops in without a second layout shift.
      this.insert(unit, tr);
      record.tr = tr;
    }
    this.records.set(id, record);
  }

  applyTranslation(id: string, translated: string): void {
    const record = this.records.get(id);
    if (!record || !translated) return;
    record.translated = translated;
    record.failed = false;

    if (record.mode === "attribute") {
      this.applyAttribute(record, translated);
      this.markApplied(record);
      return;
    }

    // Chrome: rewrite the source text NODES in place. Injecting an element at
    // block level is wrong here — the block is often a wrapper around the
    // button (`<div><a class="btn">Console</a></div>`), so the translation
    // landed outside the button while the button itself was emptied. The text
    // node is by definition inside whatever element owns the label.
    if (record.mode === "swap") {
      if (!isSameText(translated, record.unit.text)) this.swapText(record, translated);
      this.markApplied(record);
      return;
    }

    // No-op guard: if the model returned the source unchanged (a proper noun,
    // identifier, or text already in the target language), don't inject a
    // duplicate bilingual line — just drop the pending placeholder.
    if (isSameText(translated, record.unit.text)) {
      record.tr?.remove();
      record.tr = null;
      this.markApplied(record);
      return;
    }

    const tr = this.ensureTr(record);
    if (!tr) {
      // The block left the DOM (SPA re-render). Nothing to paint — but the item
      // is resolved, so it must not be counted as still pending.
      this.markApplied(record);
      return;
    }
    tr.textContent = translated;
    tr.className = this.trClass(record.mode);
    tr.removeAttribute("aria-busy");
    tr.removeAttribute("aria-label");
    tr.removeAttribute("title");
    if (this.displayMode === "replace") this.hideSource(record);
    this.markApplied(record);
  }

  markError(id: string, message: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.failed = true;
    if (record.mode === "attribute") {
      this.captureAttr(record);
      record.unit.block.title = `${normalizeText(record.unit.text)}\n${message}`;
      this.markApplied(record);
      return;
    }
    const tr = record.tr;
    if (!tr) {
      this.markApplied(record);
      return;
    }
    tr.textContent = t("labelError");
    tr.className = `${this.trClass(record.mode)} lens-error`;
    tr.title = message;
    tr.removeAttribute("aria-busy");
    this.markApplied(record);
  }

  /** Registered but never resolved — re-submitted when a session dies mid-run. */
  unresolvedSegments(): Segment[] {
    const out: Segment[] = [];
    for (const record of this.records.values()) {
      if (!record.applied && record.unit.block.isConnected) out.push({ id: record.id, text: record.unit.text });
    }
    return out;
  }

  /** Drop the placeholders of items that will never resolve (session died). */
  dropUnresolved(): void {
    for (const record of [...this.records.values()]) {
      if (record.applied) continue;
      record.tr?.remove();
      // Clear the marker in every mode, otherwise an unresolved attribute-mode
      // block keeps data-lens and is never picked up by a later scan again.
      delete record.unit.block.dataset.lens;
      delete record.unit.block.dataset.lensId;
      this.records.delete(record.id);
    }
  }

  restoreAll(): void {
    for (const record of this.records.values()) {
      if (record.mode === "attribute") {
        this.restoreAttribute(record);
        continue;
      }
      record.tr?.remove();
      this.showSource(record);
      if (record.mode === "swap") this.restoreTitle(record);
      delete record.unit.block.dataset.lens;
      delete record.unit.block.dataset.lensId;
    }
    this.records.clear();
    this.appliedCount = 0;
  }

  private trClass(mode: RenderMode): string {
    if (mode === "swap" || this.displayMode === "replace") return "lens-replace";
    return mode === "inline" ? "lens-inline" : "lens-block";
  }

  /**
   * Replace a chrome label in place: the translation goes into the first live
   * source text node and the rest are emptied. Nothing is inserted, so the
   * element's box, alignment and height are exactly what the page built.
   */
  private swapText(record: RenderRecord, translated: string): void {
    const nodes = record.unit.nodes;
    const first = nodes.findIndex((node) => node.isConnected);
    if (first < 0) return;
    if (!record.originalValues) record.originalValues = nodes.map((node) => node.nodeValue ?? "");
    nodes.forEach((node, index) => {
      if (node.isConnected) node.nodeValue = index === first ? translated : "";
    });
    // The source text is gone, so keep the original reachable on hover — on the
    // element that actually holds the label, not the (possibly wrapper) block.
    const host = nodes[first].parentElement ?? record.unit.block;
    if (host.getAttribute("title") == null) {
      host.setAttribute("title", normalizeText(record.unit.text));
      record.titleEl = host;
    }
  }

  private restoreTitle(record: RenderRecord): void {
    record.titleEl?.removeAttribute("title");
    record.titleEl = null;
  }

  private createTr(mode: RenderMode): HTMLElement {
    const tr = document.createElement("span");
    tr.className = this.trClass(mode);
    tr.dataset.lensUi = "tr";
    tr.setAttribute("translate", "no");
    tr.setAttribute("dir", "auto");
    if (this.langTag) tr.setAttribute("lang", this.langTag);
    return tr;
  }

  /**
   * Put the translation immediately AFTER the source text instead of blindly at
   * the end of the block. Appending to the block pushes the translation past
   * whatever else the block contains (a nested list, a figure, a button row),
   * which is the main reason bilingual output used to land in the wrong place.
   */
  private insert(unit: ParaUnit, tr: HTMLElement): void {
    const block = unit.block;
    const last = unit.nodes[unit.nodes.length - 1];
    let anchor: Node | null = null;
    if (last && last.isConnected) {
      // Walk up from the last source text node to the child that block owns.
      let node: Node = last;
      while (node.parentNode && node.parentNode !== block) node = node.parentNode;
      if (node.parentNode === block) anchor = node;
    }
    if (anchor && anchor.nextSibling) block.insertBefore(tr, anchor.nextSibling);
    else block.appendChild(tr);
  }

  private ensureTr(record: RenderRecord): HTMLElement | null {
    if (record.tr && record.tr.isConnected) return record.tr;
    if (!record.unit.block.isConnected) return null;
    const tr = this.createTr(record.mode);
    this.insert(record.unit, tr);
    record.tr = tr;
    return tr;
  }

  private hideSource(record: RenderRecord): void {
    if (record.originalValues) return;
    record.originalValues = record.unit.nodes.map((node) => node.nodeValue ?? "");
    for (const node of record.unit.nodes) {
      if (node.isConnected) node.nodeValue = "";
    }
  }

  private showSource(record: RenderRecord): void {
    const values = record.originalValues;
    if (!values) return;
    record.unit.nodes.forEach((node, index) => {
      if (node.isConnected) node.nodeValue = values[index];
    });
    record.originalValues = null;
  }

  /** Snapshot the original title / aria-label exactly once, before we mutate them. */
  private captureAttr(record: RenderRecord): void {
    if (record.attrHandled) return;
    const el = record.unit.block;
    record.originalTitle = el.getAttribute("title");
    record.titleAdded = record.originalTitle == null;
    record.originalAria = el.getAttribute("aria-label");
    record.ariaAdded = record.originalAria == null;
    record.attrHandled = true;
  }

  private applyAttribute(record: RenderRecord, translated: string): void {
    const el = record.unit.block;
    const original = normalizeText(record.unit.text);
    this.captureAttr(record);
    el.dataset.lens = "attr";
    el.title = `${original}\n${t("badge")}: ${translated}`;
    if (record.ariaAdded) el.setAttribute("aria-label", `${original}, ${translated}`);
  }

  private restoreAttribute(record: RenderRecord): void {
    const el = record.unit.block;
    delete el.dataset.lens;
    delete el.dataset.lensId;
    if (record.titleAdded) el.removeAttribute("title");
    else if (record.originalTitle != null) el.setAttribute("title", record.originalTitle);
    if (record.ariaAdded) el.removeAttribute("aria-label");
    else if (record.originalAria != null) el.setAttribute("aria-label", record.originalAria);
  }

  private markApplied(record: RenderRecord): void {
    if (!record.applied) {
      record.applied = true;
      this.appliedCount += 1;
    }
  }
}
