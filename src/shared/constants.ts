import type { ProviderId, ProviderPreset, Settings, TranslationColor } from "./types";

export const SETTINGS_KEY = "lensSettings";
export const CACHE_PREFIX = "lens_cache_";

/** Import preferences from earlier translator installations. */
export const LEGACY_SETTINGS_KEY = "aiTranslatorSettings";

export const MEMORY_CACHE_LIMIT = 1500;
export const CACHE_WRITE_CHUNK = 80;

export const DEFAULT_SETTINGS: Settings = {
  engine: "chrome",
  provider: "custom",
  protocol: "openai",
  endpoint: "",
  apiKey: "",
  model: "gpt-4o-mini",
  targetLang: "简体中文",
  writingLang: "English",
  maskSensitive: true,
  consistentTerms: true,
  hoverKey: "Alt",
  sourceSkip: true,
  translateUiText: true,
  glossary: "",
  displayMode: "bilingual",
  translationColor: "green",
  theme: "system",
  temperature: 0.2,
  maxSegments: 320,
  // Speed profile: many SMALL requests beat a few large ones. A request's wall
  // clock is dominated by output-token generation, so a 24-item batch takes ~3x
  // as long as an 8-item one while blocking 24 paragraphs from painting. Small
  // batches + high concurrency cut both total time and time-to-first-paint.
  maxConcurrency: 10,
  batchMaxItems: 8,
  batchMaxChars: 2400,
  requestTimeoutMs: 45000,
  cacheEnabled: true,
  cacheTtlDays: 30,
  cacheMaxEntries: 8000,
  floatingBubbleEnabled: true,
  autoTranslateEnabled: false,
  autoTranslateBatchSize: 80,
  autoTranslatePrefetchScreens: 1,
  autoTranslateDebounceMs: 400,
  siteRules: [],
  selectionToolbarRules: [],
};

export const PROVIDER_PRESETS: Record<Exclude<ProviderId, "custom">, ProviderPreset> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    endpoint: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic (Claude)",
    protocol: "anthropic",
    // Base URL only — normalizeEndpoint appends /v1/messages for the Anthropic protocol.
    endpoint: "https://api.anthropic.com",
    models: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"],
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot / Kimi",
    protocol: "openai",
    endpoint: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest"],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    endpoint: "https://api.deepseek.com/chat/completions",
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
  zhipu: {
    id: "zhipu",
    name: "Zhipu GLM",
    protocol: "openai",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-air", "glm-4-plus"],
  },
  siliconflow: {
    id: "siliconflow",
    name: "SiliconFlow",
    protocol: "openai",
    endpoint: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3"],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini (OpenAI compat)",
    protocol: "openai",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
  },
};

export const TRANSLATION_COLORS: readonly TranslationColor[] = [
  "green",
  "black",
  "blue",
  "purple",
  "amber",
] as const;

export interface ColorPreset {
  text: string;
  background: string;
  border: string;
}

// Runtime per-text payload colors for in-page bilingual text (set via
// --lens-color/-bg/-border). Aligned to the Ink design system: the default
// "green" is THE accent token, "black" is the ink token, tints are a uniform
// quiet ~0.05–0.09, and blue/purple are deepened one step for AA on white.
export const COLOR_PRESETS: Record<TranslationColor, ColorPreset> = {
  black: { text: "#18181B", background: "rgba(24, 24, 27, 0.05)", border: "#52525B" },
  green: { text: "#0F766E", background: "rgba(15, 118, 110, 0.08)", border: "#14B8A6" },
  blue: { text: "#1D4ED8", background: "rgba(29, 78, 216, 0.07)", border: "#3B82F6" },
  purple: { text: "#6D28D9", background: "rgba(109, 40, 217, 0.07)", border: "#8B5CF6" },
  amber: { text: "#B45309", background: "rgba(180, 83, 9, 0.09)", border: "#D97706" },
};

/** Common target languages shown in the options dropdown (free text is also allowed). */
export const TARGET_LANGUAGES: readonly string[] = [
  "简体中文",
  "繁體中文",
  "English",
  "日本語",
  "한국어",
  "Français",
  "Deutsch",
  "Español",
  "Русский",
  "Português",
  "Italiano",
  "العربية",
];

export const VALID_PREFETCH_SCREENS: readonly number[] = [0.5, 1, 1.5, 2];

/**
 * BCP-47 tag for each offered target language. Used for the `lang` attribute on
 * injected translations (font selection / hyphenation) and for picking a
 * speech-synthesis voice. Free-text target languages simply get no tag.
 */
const LANG_TAGS: Record<string, string> = {
  简体中文: "zh-Hans",
  繁體中文: "zh-Hant",
  English: "en",
  日本語: "ja",
  한국어: "ko",
  Français: "fr",
  Deutsch: "de",
  Español: "es",
  Русский: "ru",
  Português: "pt",
  Italiano: "it",
  العربية: "ar",
};

export function bcp47For(targetLang: string): string | null {
  return LANG_TAGS[targetLang?.trim()] ?? null;
}
