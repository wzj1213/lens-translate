import { COLOR_PRESETS } from "@shared/constants";
import type { TranslationColor } from "@shared/types";

const STYLE_ID = "lens-style";

/** 已注入的样式片段，按 key 去重 */
const injected = new Set<string>();

function styleEl(): HTMLStyleElement {
  const found = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (found) return found;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  // Marked as our own UI (not as translated content) so "restore original" and
  // the DOM scanners skip it instead of stripping its marker.
  el.dataset.lensUi = "style";
  (document.head ?? document.documentElement).appendChild(el);
  return el;
}

export function injectStyles(): void {
  addStyles("base", CSS);
}

export function addStyles(key: string, css: string): void {
  if (injected.has(key)) return;
  injected.add(key);
  const el = styleEl();
  el.textContent = `${el.textContent ?? ""}\n${css}`;
}

export function applyTheme(color: TranslationColor): void {
  const preset = COLOR_PRESETS[color] ?? COLOR_PRESETS.green;
  const root = document.documentElement.style;
  root.setProperty("--lens-color", preset.text);
  root.setProperty("--lens-bg", preset.background);
  root.setProperty("--lens-border", preset.border);
}

const CSS = `
/* ============================================================================
   AI Bilingual Translator — content (injected into arbitrary pages)
   Ink + single accent (teal). Near-monochrome ink, ONE focal accent per surface;
   everywhere else ink text + 1px hairlines. Namespaced --lens- tokens.
   ============================================================================ */

:root {
  /* Surface + ink */
  --lens-srf: #FFFFFF;
  --lens-srf-2: #FAFAF9;
  --lens-fg: #18181B;
  --lens-fg-2: #3F3F46;
  --lens-muted: #6B6B73;
  --lens-line: #E4E4E7;
  --lens-line-2: #D4D4D8;

  /* The single accent — focal only */
  --lens-accent: #0F766E;
  --lens-accent-hover: #0B5E57;
  --lens-on-accent: #FFFFFF;

  /* Tone (feedback only) */
  --lens-warning: #B45309;
  --lens-error: #B42318;

  /* One restrained elevation token — no colored / glow shadows */
  --lens-shadow: 0 1px 2px rgba(24,24,27,0.06), 0 8px 24px rgba(24,24,27,0.10);

  /* Radii: 8px chrome/chips/inputs, 12px popovers/anchors. Never 50% / 999px. */
  --lens-r-sm: 8px;
  --lens-r-lg: 12px;

  /* Floating button edge length (draggable; smaller, restrained anchor). */
  --lens-fab: 38px;

  --lens-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --lens-ease: cubic-bezier(0.2, 0, 0, 1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --lens-srf: #1C1C1F;
    --lens-srf-2: #141416;
    --lens-fg: #FAFAF9;
    --lens-fg-2: #D4D4D8;
    --lens-muted: #A1A1AA;
    --lens-line: rgba(255,255,255,0.10);
    --lens-line-2: rgba(255,255,255,0.16);
    --lens-accent: #2DD4BF;          /* bright teal = text/active accent only */
    --lens-accent-hover: #5EEAD4;
    --lens-warning: #FBBF24;
    --lens-error: #FB7185;
    --lens-shadow: 0 1px 2px rgba(0,0,0,0.40), 0 8px 24px rgba(0,0,0,0.45);
  }
}

/* ============================================================================
   Injected translation text.
   Hardening first: these nodes live inside arbitrary page CSS, so every property
   a host page commonly sets on its text containers (uppercase transforms, wide
   letter-spacing, nowrap, text-indent, line-clamp, transparent text-fill for
   gradient headings, floats) is neutralized here. Without this the translation
   inherits styling meant for a headline and renders unreadable or invisible.
   ============================================================================ */
[data-lens-ui="tr"] {
  float: none !important;
  clear: none !important;
  position: static !important;
  visibility: visible !important;
  opacity: 1 !important;
  text-transform: none !important;
  letter-spacing: normal !important;
  word-spacing: normal !important;
  white-space: normal !important;
  text-indent: 0 !important;
  text-align: start;
  text-shadow: none !important;
  text-decoration: none !important;
  font-style: normal;
  font-variant: normal;
  -webkit-text-stroke: 0 !important;
  -webkit-text-fill-color: currentColor !important;
  -webkit-line-clamp: none !important;
  max-height: none !important;
  overflow: visible !important;
  overflow-wrap: break-word;
  word-break: normal;
  user-select: text;
  vertical-align: baseline;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  direction: inherit;
  unicode-bidi: isolate;
}

/* Match the surrounding paragraph typography and use the selected translation colour. */
.lens-block, .lens-inline {
  color: var(--lens-color, #0F766E) !important;
  background: none !important;
  border: 0;
  padding: 0;
  font: inherit;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
}
.lens-block {
  display: block;
  max-width: 100%;
  margin: 0.28em 0 0.15em;
  /* Own a full line in flex/grid parents instead of becoming a sibling column.
     Ignored outside flex/grid, so it is safe to set unconditionally. Shrink is
     left enabled (with min-width:0) so a nowrap flex row can never be forced to
     overflow by the injected line. */
  flex: 1 1 100%;
  min-width: 0;
  grid-column: 1 / -1;
}
.lens-inline {
  display: inline;
  margin-inline-start: 0.4em;
}
/* Translation-only mode: the translation IS the paragraph, so it must inherit
   the page's own text styling rather than announce itself. */
.lens-replace {
  display: inline;
  color: inherit;
  background: transparent;
  font: inherit;
  line-height: inherit;
}

/* Pending: a one-line shimmer sized like the incoming text, so the real
   translation replaces it without a second layout shift. No placeholder copy. */
.lens-pending { color: transparent !important; background: transparent !important; }
.lens-pending::after {
  content: "";
  display: inline-block;
  width: 5.5em; max-width: 60%; height: 0.72em;
  vertical-align: middle; border-radius: 4px;
  background: linear-gradient(90deg, var(--lens-line) 25%, var(--lens-line-2) 37%, var(--lens-line) 63%);
  background-size: 300% 100%;
  animation: lens-shimmer 1.3s ease-in-out infinite;
}
.lens-error {
  color: var(--lens-error) !important;
  background: transparent !important;
  font-size: clamp(11px, 0.82em, 14px);
  opacity: 0.8;
  cursor: help;
}
[data-lens="attr"] {
  text-decoration: underline dotted var(--lens-border, #14b8a6);
  text-underline-offset: 0.18em;
  cursor: help;
}

@keyframes lens-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: 0 0; }
}

/* ============================================================================
   Selection toolbar — one flat hairline button. Click TRANSLATES (no caret).
   Ink chrome; the only color is the small accent "译" tile.
   ============================================================================ */
.lens-selection-bubble {
  position: fixed; z-index: 2147483647;
  display: inline-flex; align-items: center; gap: 8px;
  min-height: 34px; padding: 0 12px 0 8px;
  border: 1px solid var(--lens-line);
  border-radius: var(--lens-r-sm);
  color: var(--lens-fg-2); background: var(--lens-srf);
  box-shadow: var(--lens-shadow);
  cursor: pointer;
  font: 500 13px/1 var(--lens-font);
  letter-spacing: -0.005em;
  opacity: 0; pointer-events: none; transform: translateY(1px);
  transition: opacity .14s var(--lens-ease), transform .14s var(--lens-ease),
              border-color .14s var(--lens-ease), background-color .14s var(--lens-ease),
              color .14s var(--lens-ease);
}
.lens-selection-bubble[data-visible="true"] { opacity: 1; pointer-events: auto; transform: none; }
.lens-selection-bubble:hover { background: var(--lens-srf-2); border-color: var(--lens-line-2); color: var(--lens-fg); }
.lens-selection-bubble:active { transform: translateY(1px); }
.lens-selection-bubble:focus-visible { outline: 2px solid var(--lens-accent); outline-offset: 2px; }
.lens-selection-bubble-mark {
  display: inline-grid; place-items: center; width: 20px; height: 20px;
  border-radius: 6px; color: var(--lens-on-accent); background: var(--lens-accent);
  font-size: 12px; font-weight: 600;
}

/* ============================================================================
   Selection panel — chrome is ink; the translated RESULT is the visual center.
   ============================================================================ */
.lens-panel {
  position: fixed; z-index: 2147483647;
  width: min(380px, calc(100vw - 24px)); max-height: min(460px, calc(100vh - 24px));
  overflow: hidden;
  border: 1px solid var(--lens-line); border-radius: var(--lens-r-lg);
  background: var(--lens-srf); color: var(--lens-fg);
  box-shadow: var(--lens-shadow);
  font: 13px/1.55 var(--lens-font);
  opacity: 0; transform: translateY(2px);
  transition: opacity .16s var(--lens-ease), transform .16s var(--lens-ease);
}
.lens-panel[data-visible="true"] { opacity: 1; transform: none; }
.lens-panel-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--lens-line);
}
.lens-panel-title {
  font-size: 11px; font-weight: 600; color: var(--lens-muted);
  text-transform: uppercase; letter-spacing: 0.07em;
}
.lens-panel-actions { display: inline-flex; gap: 4px; }
/* Text-only ghost icon actions; reveal a subtle srf-2 hover surface */
.lens-icon-btn {
  display: inline-flex; align-items: center;
  min-height: 28px; padding: 0 10px;
  border: 1px solid transparent; border-radius: var(--lens-r-sm);
  color: var(--lens-muted); background: transparent; cursor: pointer;
  font: 500 12px/1 var(--lens-font); letter-spacing: -0.003em;
  transition: color .14s var(--lens-ease), background-color .14s var(--lens-ease),
              border-color .14s var(--lens-ease);
}
.lens-icon-btn:hover { color: var(--lens-fg); background: var(--lens-srf-2); }
.lens-icon-btn:active { background: var(--lens-srf-2); }
.lens-icon-btn:focus-visible { outline: 2px solid var(--lens-accent); outline-offset: 1px; }
.lens-icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.lens-panel-body { display: grid; gap: 12px; max-height: 352px; overflow: auto; padding: 16px; }
.lens-panel-source {
  max-height: 96px; overflow: auto; padding: 10px 12px;
  border: 1px solid var(--lens-line); border-radius: var(--lens-r-sm);
  color: var(--lens-muted); background: var(--lens-srf-2);
  font-size: 12px; line-height: 1.55;
}
/* Result is chrome (selection popover), so it tracks the surface-aware chrome
   accent — NOT the per-page runtime payload color (--lens-color), which is a
   light-mode preset and would fail contrast on the dark panel surface. */
.lens-panel-result {
  white-space: pre-wrap; color: var(--lens-accent);
  font-size: 15px; font-weight: 500; line-height: 1.65; min-height: 1.4em;
}
.lens-panel-result.is-loading { color: var(--lens-muted); font-weight: 450; font-style: italic; }
.lens-panel-result.is-error { color: var(--lens-error); font-weight: 500; }
.lens-panel-footer {
  padding: 0 16px 14px; color: var(--lens-muted);
  font-size: 11px; font-weight: 500; text-align: right;
  letter-spacing: 0.02em; font-variant-numeric: tabular-nums;
}

/* ============================================================================
   Toast — ink card; tone read from a slim 2px left bar (::before), never a fill.
   ============================================================================ */
.lens-toast {
  position: fixed; z-index: 2147483647; right: 18px; bottom: 18px;
  max-width: min(380px, calc(100vw - 36px));
  padding: 11px 14px 11px 16px;
  border: 1px solid var(--lens-line); border-radius: var(--lens-r-sm);
  background: var(--lens-srf); color: var(--lens-fg);
  box-shadow: var(--lens-shadow);
  font: 13px/1.5 var(--lens-font); letter-spacing: -0.002em;
  font-variant-numeric: tabular-nums;
}
.lens-toast::before {
  content: ""; position: absolute; left: 0; top: 8px; bottom: 8px;
  width: 2px; border-radius: 2px; background: var(--lens-muted);
}
.lens-toast[data-tone="success"]::before { background: var(--lens-accent); }
.lens-toast[data-tone="warning"]::before { background: var(--lens-warning); }
.lens-toast[data-tone="error"]::before   { background: var(--lens-error); }

/* ============================================================================
   Floating action button (FAB) — neutral premium INK anchor over any page.
   The wrap is exactly FAB-sized and pinned by its corner; the action menu is
   absolutely positioned so revealing it never nudges the FAB, and it flips
   up/down + left/right (data-flip / data-side) to stay on-screen when dragged.
   The wrap stays pointer-events:none so only the buttons intercept page clicks.
   Accent appears only on the auto-translate ON state and focus rings.
   ============================================================================ */
.lens-bubble-wrap {
  position: fixed; z-index: 2147483646; right: 18px; bottom: 78px;
  width: var(--lens-fab); height: var(--lens-fab);
  pointer-events: none;
}
.lens-bubble {
  position: relative; pointer-events: auto;
  width: var(--lens-fab); height: var(--lens-fab); padding: 0;
  border: none; border-radius: var(--lens-r-lg);
  display: grid; place-items: center;
  color: #FAFAF9; background: #18181B;
  box-shadow: var(--lens-shadow);
  cursor: pointer; user-select: none; touch-action: none;
  font: 600 15px/1 var(--lens-font);
  transition: background-color .14s var(--lens-ease), transform .14s var(--lens-ease),
              box-shadow .14s var(--lens-ease);
}
.lens-bubble:hover { background: #27272A; transform: translateY(-1px); }
.lens-bubble:active { transform: translateY(0); }
.lens-bubble:focus-visible { outline: 2px solid var(--lens-accent); outline-offset: 3px; }
.lens-bubble[data-busy="true"] { background: var(--lens-fg-2); cursor: progress; }
.lens-bubble[data-busy="true"]:hover { transform: none; }
.lens-bubble[data-busy="true"] span { opacity: 0; }
.lens-bubble[data-busy="true"]::after {
  content: ""; position: absolute; inset: 0; margin: auto; width: 18px; height: 18px;
  border: 2px solid rgba(250,250,249,0.30); border-top-color: #FAFAF9; border-radius: 50%;
  animation: lens-spin .8s linear infinite;
}
/* Live progress reads off the FAB itself — a hairline fill along its bottom edge —
   so a long page no longer needs a stream of progress toasts to show it is alive. */
.lens-bubble::before {
  content: ""; position: absolute; left: 0; bottom: 0; height: 2px;
  width: var(--lens-progress, 0%);
  border-end-start-radius: var(--lens-r-lg);
  background: var(--lens-accent);
  opacity: 0; transition: width .2s var(--lens-ease), opacity .2s var(--lens-ease);
}
.lens-bubble[data-busy="true"]::before { opacity: 1; }

/* Revealed labeled action chips — absolutely anchored to the FAB so opening
   never moves it. Default: above the FAB, right-aligned. */
.lens-actions {
  position: absolute; right: 0; bottom: calc(100% + 8px);
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  opacity: 0; transform: translateY(4px); pointer-events: none;
  transition: opacity .16s var(--lens-ease), transform .18s var(--lens-ease);
}
/* Flip below when dropped near the top edge. */
.lens-bubble-wrap[data-flip="down"] .lens-actions {
  bottom: auto; top: calc(100% + 8px); transform: translateY(-4px);
}
/* Anchor + align to the left when dropped on the left half. */
.lens-bubble-wrap[data-side="left"] .lens-actions {
  right: auto; left: 0; align-items: flex-start;
}
.lens-bubble-wrap[data-open="true"] .lens-actions,
.lens-bubble-wrap:focus-within .lens-actions {
  opacity: 1; transform: none; pointer-events: auto;
}
/* While dragging, hide the menu and freeze FAB micro-motion. */
.lens-bubble-wrap[data-dragging="true"] .lens-actions { display: none; }
.lens-bubble-wrap[data-dragging="true"] .lens-bubble {
  transition: none; transform: none; cursor: grabbing;
}
.lens-mini {
  /* No explicit pointer-events: chips inherit it from .lens-actions, which is
     'none' while the menu is closed — so the invisible (opacity:0) chips never
     intercept clicks/hover in the band above the FAB, only when actually open. */
  display: inline-flex; align-items: center; gap: 8px;
  height: 32px; padding: 0 14px 0 10px;
  border: 1px solid var(--lens-line); border-radius: var(--lens-r-sm);
  background: var(--lens-srf); color: var(--lens-fg-2);
  box-shadow: var(--lens-shadow); cursor: pointer; white-space: nowrap;
  font: 500 12px/1 var(--lens-font); letter-spacing: -0.003em;
  transition: background-color .12s var(--lens-ease), color .12s var(--lens-ease),
              border-color .12s var(--lens-ease), transform .12s var(--lens-ease);
}
.lens-mini:hover { background: var(--lens-srf-2); border-color: var(--lens-line-2); color: var(--lens-fg); transform: translateY(-1px); }
.lens-mini:active { transform: translateY(0); }
.lens-mini:focus-visible { outline: 2px solid var(--lens-accent); outline-offset: 2px; }
.lens-mini-icon {
  display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 6px;
  background: var(--lens-srf-2); border: 1px solid var(--lens-line);
  color: var(--lens-fg-2); font-size: 11px; font-weight: 600;
  transition: background-color .12s var(--lens-ease), color .12s var(--lens-ease),
              border-color .12s var(--lens-ease);
}
.lens-mini:hover .lens-mini-icon { border-color: var(--lens-line-2); }

/* Auto-translate ON = the one place the accent lives on the page chrome */
.lens-auto[data-enabled="true"] {
  background: var(--lens-accent); color: var(--lens-on-accent); border-color: transparent;
}
.lens-auto[data-enabled="true"]:hover {
  background: var(--lens-accent-hover); color: var(--lens-on-accent);
}
.lens-auto[data-enabled="true"] .lens-mini-icon {
  background: rgba(255,255,255,0.20); border-color: transparent; color: var(--lens-on-accent);
}
.lens-auto[data-enabled="true"]:hover .lens-mini-icon { border-color: transparent; }

/* Close — quiet danger intent on hover only (never a recolored resting border) */
.lens-close:hover {
  background: var(--lens-srf);
  border-color: color-mix(in srgb, var(--lens-error) 40%, var(--lens-line));
  color: var(--lens-error);
}
.lens-close:hover .lens-mini-icon {
  border-color: color-mix(in srgb, var(--lens-error) 40%, var(--lens-line));
  color: var(--lens-error);
}

@keyframes lens-spin { to { transform: rotate(360deg); } }

/* ============================================================================
   Dark mode — accent-fill split + FAB stays the high-contrast paper anchor.
   ============================================================================ */
@media (prefers-color-scheme: dark) {
  /* Selection mark uses an accent FILL: keep #0F766E + white text. */
  .lens-selection-bubble-mark { background: #0F766E; color: #FFFFFF; }

  /* FAB flips to paper fill with ink "译" so it stays the highest-contrast anchor. */
  .lens-bubble { background: #FAFAF9; color: #18181B; }
  .lens-bubble:hover { background: #FFFFFF; }
  .lens-bubble[data-busy="true"] { background: var(--lens-fg-2); color: #18181B; }
  .lens-bubble[data-busy="true"]::after {
    border-color: rgba(24,24,27,0.30); border-top-color: #18181B;
  }

  /* Auto ON fill uses #0F766E + white text for legibility in dark. */
  .lens-auto[data-enabled="true"] { background: #0F766E; color: #FFFFFF; }
  .lens-auto[data-enabled="true"]:hover { background: #0B5E57; color: #FFFFFF; }
  .lens-auto[data-enabled="true"] .lens-mini-icon { background: rgba(255,255,255,0.20); color: #FFFFFF; }

  .lens-close:hover { color: var(--lens-error); border-color: color-mix(in srgb, var(--lens-error) 45%, var(--lens-line)); }
  .lens-close:hover .lens-mini-icon { color: var(--lens-error); border-color: color-mix(in srgb, var(--lens-error) 45%, var(--lens-line)); }
}

/* ============================================================================
   Reduced motion
   ============================================================================ */
@media (prefers-reduced-motion: reduce) {
  .lens-selection-bubble, .lens-panel, .lens-icon-btn, .lens-mini,
  .lens-mini-icon, .lens-bubble, .lens-actions, .lens-toast {
    transition: opacity .12s linear !important;
    transform: none !important;
  }
  .lens-bubble:hover, .lens-mini:hover,
  .lens-auto[data-enabled="true"]:hover { transform: none !important; }
  .lens-bubble[data-busy="true"]::after { animation: none; }
  .lens-pending::after { animation: none; }
}

/* ============================================================================
   Narrow viewport
   ============================================================================ */
@media (max-width: 520px) {
  .lens-bubble-wrap { right: 12px; bottom: 70px; }
}
`;
