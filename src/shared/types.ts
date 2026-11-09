// Single source of truth for the data shapes shared across all four bundles
// (service worker, content script, options, popup). No runtime code here.

export type DisplayMode = "bilingual" | "replace";
export type ThemeMode = "system" | "light" | "dark";
export type TranslationColor = "green" | "black" | "blue" | "purple" | "amber";
export type SiteRuleMode = "always" | "never" | "auto";
export type SelectionToolbarMode = "auto" | "manual" | "off";
export interface SelectionToolbarRule {
  /** Exact web origin, including protocol and port. */
  origin: string;
  mode: SelectionToolbarMode;
}
/** Wire protocol for the upstream LLM API. OpenAI Chat Completions vs Anthropic Messages. */
export type ApiProtocol = "openai" | "anthropic";
export type ProviderId =
  | "openai"
  | "anthropic"
  | "moonshot"
  | "deepseek"
  | "zhipu"
  | "siliconflow"
  | "gemini"
  | "custom";

export interface SiteRule {
  host: string;
  mode: SiteRuleMode;
}

export interface Settings {
  engine: "chrome" | "model";
  provider: ProviderId;
  protocol: ApiProtocol;
  endpoint: string;
  apiKey: string;
  model: string;
  targetLang: string;
  writingLang: string;
  maskSensitive: boolean;
  consistentTerms: boolean;
  hoverKey: "Alt" | "Shift" | "off";
  sourceSkip: boolean;
  /** Translate article content only — skip nav / sidebar / header / footer / UI labels. */
  translateUiText: boolean;
  glossary: string;
  displayMode: DisplayMode;
  translationColor: TranslationColor;
  theme: ThemeMode;
  temperature: number;
  maxSegments: number;
  maxConcurrency: number;
  batchMaxItems: number;
  batchMaxChars: number;
  requestTimeoutMs: number;
  cacheEnabled: boolean;
  cacheTtlDays: number;
  cacheMaxEntries: number;
  floatingBubbleEnabled: boolean;
  autoTranslateEnabled: boolean;
  autoTranslateBatchSize: number;
  autoTranslatePrefetchScreens: number;
  autoTranslateDebounceMs: number;
  siteRules: SiteRule[];
  selectionToolbarRules: SelectionToolbarRule[];
}

/** The subset of settings the content script is allowed to see — never the key. */
export interface PublicSettings {
  model: string;
  targetLang: string;
  sourceSkip: boolean;
  translateUiText: boolean;
  displayMode: DisplayMode;
  translationColor: TranslationColor;
  theme: ThemeMode;
  maxSegments: number;
  cacheEnabled: boolean;
  floatingBubbleEnabled: boolean;
  autoTranslateEnabled: boolean;
  autoTranslateBatchSize: number;
  autoTranslatePrefetchScreens: number;
  autoTranslateDebounceMs: number;
}

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  protocol: ApiProtocol;
  endpoint: string;
  models: string[];
}

/**
 * Where the text came from. Sent to the model as disambiguation context only —
 * short UI strings ("Effort matters more", "Fast mode") are otherwise impossible
 * to sense-disambiguate. Derived in the service worker from the port's sender,
 * so it never has to be trusted from page content.
 */
export interface PageContext {
  title: string;
  host: string;
  sentence?: string;
  topic?: string;
}

/** A unit of text to translate. ids are extension-generated, never page-supplied. */
export interface Segment {
  id: string;
  text: string;
}

export interface TranslatedItem {
  id: string;
  translated: string;
}

export interface CacheStats {
  count: number;
  bytes: number;
}

export interface MemoryCacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

// --- Messaging contracts ---

export type ContentCommand =
  | "SHOW_SELECTION_TOOLBAR"
  | "TRANSLATE_PAGE"
  | "TOGGLE_PAGE"
  | "TRANSLATE_SELECTION"
  | "RESTORE_ORIGINAL"
  | "STOP_TRANSLATION"
  | "TOGGLE_AUTO"
  | "TOGGLE_DISPLAY_MODE"
  | "TRANSLATE_INPUT"
  | "UNDO_INPUT"
  | "TOGGLE_CAPTIONS"
  | "GET_STATUS";

/** Live page state the popup renders (returned by GET_STATUS). */
export interface PageStatus {
  active: boolean;
  captions?: boolean;
  translated: number;
  busy: boolean;
  auto: boolean;
  displayMode: DisplayMode;
}

export interface CacheStatsResponse {
  ok: true;
  count: number;
  bytes: number;
}

/** One-shot messages sent to the service worker via chrome.runtime.sendMessage. */
export type RuntimeRequest =
  | { type: "TEST_CONNECTION"; settings: Partial<Settings> }
  | { type: "BROADCAST_COMMAND"; command: ContentCommand }
  | { type: "GET_CACHE_STATS" }
  | { type: "CLEAR_CACHE" };

/** Service-worker -> tab command envelope (chrome.tabs.sendMessage). */
export interface CommandEnvelope {
  type: "LENS_COMMAND";
  command: ContentCommand;
}

// --- Selection (streaming) port protocol ---

export type SelectionInbound = { type: "TRANSLATE"; text: string; targetLang?: string; sentence?: string };

export type SelectionOutbound =
  | { type: "DELTA"; chunk: string }
  | { type: "DONE"; translated: string; fromCache: boolean }
  | { type: "ERROR"; message: string };

// --- Port (session) protocol ---

export type PortInbound =
  | { type: "START_TRANSLATION"; segments: Segment[]; sample?: string }
  /** Feed more segments into a run that is already in flight (no new round-trip stall). */
  | { type: "APPEND_SEGMENTS"; segments: Segment[] }
  | { type: "CANCEL_TRANSLATION" };

export type PortOutbound =
  | { type: "SESSION_STARTED"; sessionId: string; total: number; settings: PublicSettings }
  | { type: "TRANSLATION_RESULT"; items: TranslatedItem[]; fromCache: boolean }
  | { type: "TRANSLATION_ERROR"; ids: string[]; message: string }
  | { type: "PROGRESS"; total: number; completed: number; failed: number; concurrency: number }
  | { type: "RETRYING"; message: string }
  | { type: "SESSION_COMPLETE"; total: number; completed: number; failed: number }
  | { type: "SESSION_CANCELLED"; reason: string }
  | { type: "FATAL_ERROR"; message: string };
