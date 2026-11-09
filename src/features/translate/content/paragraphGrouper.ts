import { inReadingArea } from "./siteProfile";
import { hasHumanText, looksLikeOnlyUrlOrSymbol, looksUntranslatable, normalizeText } from "@shared/util";

/**
 * How a unit's translation is put on the page.
 *  block/inline — bilingual: the translation is added next to the source.
 *  swap         — the label text is REPLACED in place (original kept in `title`).
 *                 Used for page chrome: adding a line there would double a
 *                 fixed-height row's content and overlap the next one.
 *  attribute    — title/aria only, for containers that cannot hold a child node.
 */
export type RenderMode = "block" | "inline" | "swap" | "attribute";

export interface ParaUnit {
  /** Block element that owns the grouped text and receives the translation. */
  block: HTMLElement;
  /** Grouped text nodes in document order (shared block ancestor). */
  nodes: Text[];
  /** Normalized, joined paragraph text sent to the model. */
  text: string;
  renderMode: RenderMode;
}

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE",
  "KBD", "SAMP", "SVG", "CANVAS", "MATH", "IFRAME", "OBJECT", "EMBED", "VIDEO", "AUDIO",
]);

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH",
  "DD", "DT", "DL", "FIGCAPTION", "FIGURE", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER",
  "MAIN", "NAV", "FORM", "TABLE", "TR", "CAPTION", "ADDRESS", "DETAILS", "SUMMARY", "BODY",
]);

const BLOCK_DISPLAYS = new Set([
  "block", "list-item", "table-cell", "table-caption", "flex", "grid", "flow-root", "table", "table-row",
]);

/**
 * Containers where inserting a child node is invalid or visibly destructive —
 * a <span> inside <table>/<tr> is re-parented by the HTML parser, and a growing
 * tab strip breaks. These fall back to a title/aria-label translation.
 * NOTE: table CELLS are deliberately NOT here — they render a real visible
 * translation, because hiding a whole table's translation in tooltips was one of
 * the biggest bilingual-mode complaints.
 */
const STRUCT_SELECTOR =
  "table,thead,tbody,tfoot,tr,colgroup,select,optgroup,datalist," +
  "[role='table'],[role='grid'],[role='row'],[role='rowgroup'],[role='tablist'],[role='listbox']";

/** Cells and compact widgets: a translation belongs here, but must stay compact. */
const COMPACT_SELECTOR =
  "td,th,caption,button,summary,label,[role='gridcell'],[role='cell']," +
  "[role='columnheader'],[role='rowheader'],[role='tab'],[role='button'],[role='option'],[role='menuitem']";

const NAV_SELECTOR = "nav,[role='navigation'],[role='menu'],[role='menubar'],[role='toolbar']";

/** Above this length an inline translation stops being compact and becomes a block. */
const COMPACT_MAX_LEN = 24;
const NAV_MAX_LEN = 40;

const MIN_LEN = 2;
const MAX_LEN = 2000;

/**
 * Page chrome: nav bars, sidebars, tables of contents, toolbars, buttons.
 * Bilingual mode necessarily DOUBLES a text block's height, and these are exactly
 * the containers built at a fixed height — an added line overlaps the next row
 * instead of pushing it down, which cannot be fixed from inside the injected
 * node. So chrome is translated in "swap" mode instead: replaced in place, no
 * height change, original preserved in the title tooltip.
 */
const CHROME_SELECTOR =
  "nav,aside,[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary']," +
  "[role='menu'],[role='menubar'],[role='toolbar'],[role='tablist'],[role='search']";
/** header/footer are page chrome only outside of article/section/main. */
const CONTENT_SCOPES = "article,section,main,[role='article'],[role='main']";

/** Interactive wrappers whose whole text is a label rather than prose. */
const LABEL_HOSTS = "a,button,summary,label,[role='button'],[role='link'],[role='tab'],[role='menuitem'],[role='option']";
/** A pure label at or below this length is UI regardless of context. */
const UI_LABEL_MAX = 30;
/** Above that, it is UI only inside a link list (sidebar / table of contents). */
const LINK_LIST_MIN_LINKS = 3;
const LINK_LIST_MIN_DENSITY = 0.8;

let translateUiText = true;

/** Mirror of the `translateUiText` setting; set from the content script on load. */
export function setTranslateUiText(value: boolean): void {
  translateUiText = value;
}

// Per-pass memo: getComputedStyle is the single most expensive call in a scan and
// the same ancestors get asked repeatedly for every text node beneath them.
// Cleared at the start of each collect pass — layout does not change mid-pass.
let styleCache = new WeakMap<Element, CSSStyleDeclaration | null>();
let visibleCache = new WeakMap<Element, boolean>();

export function resetScanCaches(): void {
  styleCache = new WeakMap<Element, CSSStyleDeclaration | null>();
  visibleCache = new WeakMap<Element, boolean>();
}

export function isTranslatableTextValue(raw: string): boolean {
  const text = normalizeText(raw);
  if (text.length < MIN_LEN || text.length > MAX_LEN) return false;
  if (!hasHumanText(text)) return false;
  if (looksLikeOnlyUrlOrSymbol(text)) return false;
  return true;
}

function getStyle(el: Element): CSSStyleDeclaration | null {
  const cached = styleCache.get(el);
  if (cached !== undefined) return cached;
  let style: CSSStyleDeclaration | null = null;
  try {
    style = el.ownerDocument.defaultView?.getComputedStyle(el) ?? null;
  } catch {
    style = null;
  }
  styleCache.set(el, style);
  return style;
}

export function shouldSkipElement(el: Element | null): boolean {
  if (el && !inReadingArea(el)) return true;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (SKIP_TAGS.has(cur.tagName)) return true;
    if (cur.getAttribute("aria-hidden") === "true") return true;
    if (cur instanceof HTMLElement) {
      if (cur.isContentEditable) return true;
      if (cur.dataset.lens || cur.dataset.lensUi) return true;
    }
    if (cur.tagName === "BODY" || cur.tagName === "HTML") break;
  }
  return false;
}

/** Semantic page chrome, or a page-level (not article-level) header/footer. */
function inPageChrome(block: HTMLElement): boolean {
  if (block.closest(CHROME_SELECTOR)) return true;
  const scoped = block.closest("header,footer");
  return Boolean(scoped && !scoped.parentElement?.closest(CONTENT_SCOPES));
}

/**
 * A block whose text IS the entire text of a link/button — a sidebar entry, a
 * menu item, a breadcrumb, a "Copy page" button. Comparing against the host's
 * FULL text is what separates these from a content card, where the link wraps a
 * heading plus a paragraph and is far longer than this block.
 */
function isUiLabel(block: HTMLElement, text: string): boolean {
  // The link can be an ancestor of the block (a card wrapped in <a>) or its
  // child (`<div class="sidebar-item"><a>Label</a></div>` — sidebars are usually
  // plain divs, so semantic selectors alone never catch them).
  const host = block.closest(LABEL_HOSTS) ?? block.querySelector(LABEL_HOSTS);
  if (!host) return false;
  if (normalizeText(host.textContent ?? "") !== text) return false;
  if (text.length <= UI_LABEL_MAX) return true;
  // Long entries (a table of contents) count only when they sit in a list that
  // is almost entirely links — that is what a nav is and an article is not.
  return inLinkList(host);
}

function inLinkList(host: Element): boolean {
  let cur = host.parentElement;
  for (let depth = 0; cur && depth < 3; depth += 1, cur = cur.parentElement) {
    const links = [...cur.querySelectorAll("a[href]")];
    if (links.length < LINK_LIST_MIN_LINKS) continue;
    const linkChars = links.reduce((sum, link) => sum + normalizeText(link.textContent ?? "").length, 0);
    const allChars = normalizeText(cur.textContent ?? "").length;
    if (allChars > 0 && linkChars / allChars >= LINK_LIST_MIN_DENSITY) return true;
  }
  return false;
}

function isVisible(el: Element): boolean {
  const top = el.ownerDocument.documentElement;
  const chain: Element[] = [];
  let cur: Element | null = el;
  let result = true;

  // Walk up only until a cached ancestor answer is found, then memoize the chain.
  while (cur && cur !== top) {
    const cached = visibleCache.get(cur);
    if (cached !== undefined) {
      result = cached;
      break;
    }
    const style = getStyle(cur);
    if (style) {
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        result = false;
        break;
      }
      if (style.opacity !== "" && Number(style.opacity) === 0) {
        result = false;
        break;
      }
    }
    chain.push(cur);
    cur = cur.parentElement;
  }

  if (cur && cur !== top && result === false) visibleCache.set(cur, false);
  for (const node of chain) visibleCache.set(node, result);
  return result;
}

function nearestBlock(node: Text): HTMLElement | null {
  let el = node.parentElement;
  while (el) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    const style = getStyle(el);
    if (style && BLOCK_DISPLAYS.has(style.display)) return el;
    if (el.tagName === "BODY") return el;
    el = el.parentElement;
  }
  return null;
}

function matches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

function renderModeFor(block: HTMLElement, text: string, chrome: boolean): RenderMode {
  // Only the block ITSELF being a structural container forces attribute mode.
  // (This used to be a `closest()`, which swept every cell of every table into
  // tooltip-only mode — tables looked untranslated in bilingual mode.)
  if (matches(block, STRUCT_SELECTOR)) return "attribute";
  // Chrome is replaced in place — never given a second line.
  if (chrome) return "swap";
  // Compact contexts (table cells, buttons, tabs): keep short labels on the same
  // line so the grid/row height doesn't jump; longer text still gets its own line.
  if (matches(block, COMPACT_SELECTOR)) return text.length <= COMPACT_MAX_LEN ? "inline" : "block";
  // Short nav/menu labels: render the translation visibly but compactly inline
  // (e.g. "Models 模型") rather than hiding it in a tooltip. Longer items fall
  // through to block so we don't stretch a single menu row too far.
  if (text.length <= NAV_MAX_LEN && block.closest(NAV_SELECTOR)) return "inline";
  return "block";
}

/** Pure structural grouping: text nodes keyed by their nearest block ancestor. */
export function groupParagraphs(
  root: ParentNode,
  accept: (raw: string) => boolean = isTranslatableTextValue,
): Map<HTMLElement, Text[]> {
  const groups = new Map<HTMLElement, Text[]>();
  const doc = (root as Node).ownerDocument ?? document;
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const text = node as Text;
      if (!accept(text.nodeValue ?? "")) return NodeFilter.FILTER_REJECT;
      const parent = text.parentElement;
      if (!parent || shouldSkipElement(parent) || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const block = nearestBlock(node);
    if (!block) continue;
    const existing = groups.get(block);
    if (existing) existing.push(node);
    else groups.set(block, [node]);
  }
  return groups;
}

export function toUnit(block: HTMLElement, nodes: Text[]): ParaUnit | null {
  const text = normalizeText(nodes.map((node) => node.nodeValue ?? "").join(" "));
  if (!isTranslatableTextValue(text)) return null;
  // Leave proper nouns / model names / version & code identifiers untouched
  // (e.g. chart axis labels like "Claude Opus 4.8 (max)", "GPT-5.5").
  if (looksUntranslatable(text)) return null;
  const chrome = inPageChrome(block) || isUiLabel(block, text);
  if (chrome && !translateUiText) return null;
  return { block, nodes, text, renderMode: renderModeFor(block, text, chrome) };
}

function openShadowRoots(root: ParentNode): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const doc = (root as Node).ownerDocument ?? document;
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node: Node) =>
      (node as Element).shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  while (walker.nextNode()) {
    const shadow = (walker.currentNode as Element).shadowRoot;
    if (shadow) {
      out.push(shadow);
      out.push(...openShadowRoots(shadow));
    }
  }
  return out;
}

/** Collect translation units from a root and its open shadow roots. */
export function collectUnits(root: ParentNode = document.body): ParaUnit[] {
  if (!root) return [];
  resetScanCaches();
  const roots: ParentNode[] = [root, ...openShadowRoots(root)];
  const units: ParaUnit[] = [];
  for (const r of roots) {
    for (const [block, nodes] of groupParagraphs(r)) {
      const unit = toUnit(block, nodes);
      if (unit) units.push(unit);
    }
  }
  return units;
}

/**
 * Collect units from a set of subtree roots instead of the whole document.
 * Used for scroll/mutation passes: re-walking `document.body` every time is the
 * single most expensive thing auto-translate does on a long page.
 */
export function collectUnitsIn(roots: Element[]): ParaUnit[] {
  resetScanCaches();
  const units: ParaUnit[] = [];
  const seen = new Set<HTMLElement>();
  for (const root of roots) {
    if (!root.isConnected) continue;
    for (const scope of [root as ParentNode, ...openShadowRoots(root)]) {
      for (const [block, nodes] of groupParagraphs(scope)) {
        if (seen.has(block)) continue;
        seen.add(block);
        // The owning block can extend past the scanned root (a text node added
        // into the middle of an existing paragraph). Re-group from the block so
        // the paragraph is translated whole instead of as a fragment.
        const contained = (scope as unknown as Node).contains?.(block) ?? false;
        const full = contained ? nodes : (groupParagraphs(block).get(block) ?? nodes);
        const unit = toUnit(block, full);
        if (unit) units.push(unit);
      }
    }
  }
  return units;
}
