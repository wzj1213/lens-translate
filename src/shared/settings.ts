import {
  DEFAULT_SETTINGS, LEGACY_SETTINGS_KEY, SETTINGS_KEY,
  TRANSLATION_COLORS, VALID_PREFETCH_SCREENS,
} from "./constants";
import type {
  ApiProtocol,
  DisplayMode,
  ProviderId,
  PublicSettings,
  Settings,
  SiteRule,
  SiteRuleMode,
  ThemeMode,
} from "./types";
import { clampFloat, clampInt } from "./util";
import { sanitizeSelectionToolbarRules } from "./selectionRules";

const PROVIDERS: readonly ProviderId[] = [
  "openai",
  "anthropic",
  "moonshot",
  "deepseek",
  "zhipu",
  "siliconflow",
  "gemini",
  "custom",
];
const PROTOCOLS: readonly ApiProtocol[] = ["openai", "anthropic"];
const THEMES: readonly ThemeMode[] = ["system", "light", "dark"];
const DISPLAY_MODES: readonly DisplayMode[] = ["bilingual", "replace"];
const RULE_MODES: readonly SiteRuleMode[] = ["always", "never", "auto"];

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback;
}

/** Pure: merge with defaults, clamp every numeric range, validate every enum. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  const endpoint = String(s.endpoint ?? "").trim();
  const prefetch = Number(s.autoTranslatePrefetchScreens);
  return {
    provider: oneOf(PROVIDERS, s.provider, "custom"),
    protocol: oneOf(PROTOCOLS, s.protocol, "openai"),
    engine: oneOf(["chrome", "model"] as const, raw?.engine, endpoint ? "model" : "chrome"),
    endpoint,
    apiKey: String(s.apiKey ?? "").trim(),
    model: String(s.model ?? "").trim() || DEFAULT_SETTINGS.model,
    targetLang: String(s.targetLang ?? "").trim() || DEFAULT_SETTINGS.targetLang,
    writingLang: String(s.writingLang || DEFAULT_SETTINGS.writingLang).trim().slice(0, 80) || DEFAULT_SETTINGS.writingLang,
    maskSensitive: s.maskSensitive !== false,
    consistentTerms: s.consistentTerms !== false,
    hoverKey: oneOf(["Alt", "Shift", "off"] as const, s.hoverKey, "Alt"),
    sourceSkip: s.sourceSkip !== false,
    translateUiText: s.translateUiText !== false,
    glossary: String(s.glossary ?? ""),
    displayMode: oneOf(DISPLAY_MODES, s.displayMode, "bilingual"),
    translationColor: oneOf(TRANSLATION_COLORS, s.translationColor, DEFAULT_SETTINGS.translationColor),
    theme: oneOf(THEMES, s.theme, "system"),
    temperature: clampFloat(s.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    maxSegments: clampInt(s.maxSegments, 50, 1200, DEFAULT_SETTINGS.maxSegments),
    maxConcurrency: clampInt(s.maxConcurrency, 1, 24, DEFAULT_SETTINGS.maxConcurrency),
    batchMaxItems: clampInt(s.batchMaxItems, 4, 100, DEFAULT_SETTINGS.batchMaxItems),
    batchMaxChars: clampInt(s.batchMaxChars, 1000, 16000, DEFAULT_SETTINGS.batchMaxChars),
    requestTimeoutMs: clampInt(s.requestTimeoutMs, 8000, 120000, DEFAULT_SETTINGS.requestTimeoutMs),
    cacheEnabled: s.cacheEnabled !== false,
    cacheTtlDays: clampInt(s.cacheTtlDays, 1, 365, DEFAULT_SETTINGS.cacheTtlDays),
    cacheMaxEntries: clampInt(s.cacheMaxEntries, 500, 50000, DEFAULT_SETTINGS.cacheMaxEntries),
    floatingBubbleEnabled: s.floatingBubbleEnabled !== false,
    autoTranslateEnabled: s.autoTranslateEnabled === true,
    autoTranslateBatchSize: clampInt(s.autoTranslateBatchSize, 10, 200, DEFAULT_SETTINGS.autoTranslateBatchSize),
    autoTranslatePrefetchScreens: VALID_PREFETCH_SCREENS.includes(prefetch)
      ? prefetch
      : DEFAULT_SETTINGS.autoTranslatePrefetchScreens,
    autoTranslateDebounceMs: clampInt(s.autoTranslateDebounceMs, 200, 3000, DEFAULT_SETTINGS.autoTranslateDebounceMs),
    siteRules: sanitizeSiteRules(s.siteRules),
    selectionToolbarRules: sanitizeSelectionToolbarRules(s.selectionToolbarRules),
  };
}

function sanitizeSiteRules(rules: unknown): SiteRule[] {
  if (!Array.isArray(rules)) return [];
  const out: SiteRule[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const host = String((rule as { host?: unknown })?.host ?? "").trim().toLowerCase();
    const mode = (rule as { mode?: unknown })?.mode;
    if (!host || seen.has(host) || !RULE_MODES.includes(mode as SiteRuleMode)) continue;
    seen.add(host);
    out.push({ host, mode: mode as SiteRuleMode });
  }
  return out;
}

/** Strip secrets: only this subset is ever sent to a content script. */
export function publicSettings(s: Settings): PublicSettings {
  return {
    model: s.model,
    targetLang: s.targetLang,
    sourceSkip: s.sourceSkip,
    translateUiText: s.translateUiText,
    displayMode: s.displayMode,
    translationColor: s.translationColor,
    theme: s.theme,
    maxSegments: s.maxSegments,
    cacheEnabled: s.cacheEnabled,
    floatingBubbleEnabled: s.floatingBubbleEnabled,
    autoTranslateEnabled: s.autoTranslateEnabled,
    autoTranslateBatchSize: s.autoTranslateBatchSize,
    autoTranslatePrefetchScreens: s.autoTranslatePrefetchScreens,
    autoTranslateDebounceMs: s.autoTranslateDebounceMs,
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  const current = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  if (current) return normalizeSettings(current);

  // Normalize older preferences before writing them under the current key.
  const legacy = stored[LEGACY_SETTINGS_KEY] as Partial<Settings> | undefined;
  if (legacy) {
    const migrated = normalizeSettings(legacy);
    await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
    await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
    return migrated;
  }
  return normalizeSettings(undefined);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}
