// Small pure helpers shared everywhere. Keep DOM/chrome-free so they unit-test.

/** Collapse runs of whitespace to single spaces and trim. */
export function normalizeText(text: string | null | undefined): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Split a raw selection (`Selection.toString()`, which keeps block boundaries as
 * newlines) into display paragraphs. Any run of newlines splits — paragraphs are
 * separated by blank lines, list items / table rows by single newlines — and each
 * paragraph's inner whitespace is collapsed. Empty fragments are dropped.
 */
export function splitSelectionParagraphs(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** True when the text contains at least one letter (any script). */
export function hasHumanText(text: string): boolean {
  return /[\p{L}]/u.test(text);
}

/** True when the text is essentially a bare URL or punctuation/symbols only. */
export function looksLikeOnlyUrlOrSymbol(text: string): boolean {
  if (/^https?:\/\/\S+$/i.test(text)) return true;
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(text)) return true; // bare email
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "");
  return letters.length / Math.max(text.length, 1) < 0.15;
}

/**
 * True when a SHORT fragment looks like a proper noun, product/model/version name,
 * or code identifier that should be left untranslated — e.g. "GPT-5.5",
 * "Claude Opus 4.8 (max)", "Gemini 3.1 Pro Preview", "MiniMax-M3", "gpt-oss-120b".
 *
 * Deliberately conservative: only fires on short, non-sentence fragments, so real
 * UI labels ("Models", "Speed", "Coding Agents") and prose are never affected.
 * This mirrors what mainstream translators do — skip chart axis labels, tags and
 * identifiers rather than mangling them and wrecking the layout.
 */
export function looksUntranslatable(text: string): boolean {
  const t = normalizeText(text);
  if (!t || t.length > 40) return false; // long text is treated as prose
  if (/[.!?。！？,，;；:：]\s/.test(t)) return false; // sentence/clause punctuation -> prose
  if (!/[\p{L}]/u.test(t)) return false; // no letters -> handled by other filters
  const words = t.split(" ");
  if (words.length > 5) return false;

  // Single token: skip when it carries code / version / identifier shape.
  if (words.length === 1) {
    if (/\d/.test(t)) return true; // GPT-5.5, v2, M3, COVID-19 ...
    if (/[a-z][A-Z]/.test(t)) return true; // camelCase / MixedCase
    if (/[_/\\]/.test(t)) return true; // path-like identifier
    return false; // a plain single word -> translate it
  }

  // Multi-word phrase that carries a version/number AND reads like a name: every
  // token is a number, a parenthetical (max)/(high), or a Capitalized/identifier
  // word. A single lowercase common word (e.g. "Top 10 models") disqualifies it.
  if (!/\d/.test(t)) return false;
  return words.every((w) => {
    if (/^\(.*\)$/.test(w)) return true; // (max), (high), (xhigh)
    const core = w.replace(/[()[\]{}.,]/g, "");
    if (!core || !/[a-zA-Z]/.test(core)) return true; // pure number / symbol
    if (/\d/.test(core) || /[-_/]/.test(core)) return true; // identifier-ish token
    if (/[a-z][A-Z]/.test(core)) return true; // iPhone, MiniMax
    return /^[A-Z]/.test(core); // Capitalized word
  });
}

export function createId(prefix: string): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function toUserMessage(error: unknown): string {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || "Unknown error.";
  return String(error);
}

export function trimErrorText(text: string, max = 240): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
