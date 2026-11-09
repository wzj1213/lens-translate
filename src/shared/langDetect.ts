// Lightweight script-based language detection for the source-skip feature.
// Detection is heuristic and intentionally conservative: we only skip a
// paragraph when we are confident it is already in the target language.

export type LangCode =
  | "zh"
  | "ja"
  | "ko"
  | "ru"
  | "ar"
  | "he"
  | "el"
  | "th"
  | "hi"
  | "en"
  | "latin"
  | "unknown";

const SCRIPT_TARGETS: ReadonlySet<LangCode> = new Set(["zh", "ja", "ko", "ru", "ar", "he", "el", "th", "hi"]);

/**
 * Coarse script detection. Order matters: Japanese kana and Korean hangul are
 * checked before Han so Japanese/Korean text is never misread as Chinese.
 */
export function detectBaseLang(text: string): LangCode {
  const sample = text.slice(0, 600);
  const counts: Record<string, number> = {};
  let letters = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    const script = scriptOf(code);
    if (!script) continue;
    counts[script] = (counts[script] ?? 0) + 1;
    letters += 1;
  }
  if (letters === 0) return "unknown";

  if ((counts.kana ?? 0) > 0) return "ja";
  if ((counts.hangul ?? 0) > 0) return "ko";
  if ((counts.han ?? 0) > 0) return "zh";

  const ranked = (["cyrillic", "arabic", "hebrew", "greek", "thai", "devanagari", "latin"] as const)
    .map((s) => [s, counts[s] ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  const [topScript, topCount] = ranked[0];
  if (topCount === 0) return "unknown";

  switch (topScript) {
    case "cyrillic":
      return "ru";
    case "arabic":
      return "ar";
    case "hebrew":
      return "he";
    case "greek":
      return "el";
    case "thai":
      return "th";
    case "devanagari":
      return "hi";
    default:
      return "latin";
  }
}

function scriptOf(code: number): string | null {
  if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff)) return "kana";
  if (code >= 0xac00 && code <= 0xd7a3) return "hangul";
  if (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff)
  )
    return "han";
  if (code >= 0x0400 && code <= 0x04ff) return "cyrillic";
  if ((code >= 0x0600 && code <= 0x06ff) || (code >= 0x0750 && code <= 0x077f)) return "arabic";
  if (code >= 0x0590 && code <= 0x05ff) return "hebrew";
  if (code >= 0x0370 && code <= 0x03ff) return "greek";
  if (code >= 0x0e00 && code <= 0x0e7f) return "thai";
  if (code >= 0x0900 && code <= 0x097f) return "devanagari";
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0xc0 && code <= 0x24f))
    return "latin";
  return null;
}

const TARGET_PATTERNS: Array<[RegExp, LangCode]> = [
  [/中文|汉语|漢語|chinese|zh|cn/i, "zh"],
  [/日本語|日语|japanese|ja|jp/i, "ja"],
  [/한국|韩语|korean|ko|kr/i, "ko"],
  [/english|英语|英文|^en$/i, "en"],
  [/русск|russian|^ru$/i, "ru"],
  [/عربية|arabic|^ar$/i, "ar"],
  [/עברית|hebrew|^he$/i, "he"],
  [/ελλην|greek|^el$/i, "el"],
  [/ไทย|thai|^th$/i, "th"],
];

export function targetLangToCode(targetLang: string): LangCode {
  const t = String(targetLang || "").trim();
  for (const [pattern, code] of TARGET_PATTERNS) {
    if (pattern.test(t)) return code;
  }
  return "unknown";
}

const EN_STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "is", "it", "you", "that", "for", "on", "with", "as", "are",
  "this", "be", "at", "by", "an", "or", "we", "your", "can", "will", "from", "have", "not",
]);

function looksEnglish(text: string): boolean {
  const ascii = text.replace(/[^\x00-\x7f]/g, "");
  if (ascii.length / Math.max(text.length, 1) < 0.85) return false;
  const words = ascii.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 3) return false;
  let hits = 0;
  const seen = new Set<string>();
  for (const w of words) {
    if (EN_STOPWORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      hits += 1;
    }
  }
  return hits >= 2;
}

/**
 * True when `text` is already in the target language and translation can be
 * skipped. Reliable for script-identifiable targets (Chinese, Japanese, …) and
 * uses an English stopword heuristic for English targets. For other Latin-script
 * targets it never skips, to avoid hiding genuinely-foreign text.
 */
export function shouldSkipTranslation(text: string, targetLang: string): boolean {
  const target = targetLangToCode(targetLang);
  if (target === "unknown") return false;
  const base = detectBaseLang(text);

  if (SCRIPT_TARGETS.has(target)) return base === target;
  if (target === "en") return base === "latin" && looksEnglish(text);
  return false;
}
