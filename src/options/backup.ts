import { DEFAULT_SETTINGS } from "@shared/constants";
import { httpOrigin } from "@shared/endpoint";
import { normalizeSettings } from "@shared/settings";
import type { Settings } from "@shared/types";

export function exportSettings(settings: Settings, includeKey: boolean): Partial<Settings> {
  const backup: Partial<Settings> = { ...settings };
  if (!includeKey) delete backup.apiKey;
  return backup;
}

export function importSettings(value: unknown, current: Settings): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Object.keys(DEFAULT_SETTINGS).some((key) => Object.hasOwn(value, key))) {
    throw new Error("Invalid settings file");
  }
  const settings = normalizeSettings(value as Partial<Settings>);
  const origin = httpOrigin(settings.endpoint);
  if (!Object.hasOwn(value, "apiKey") && origin && origin === httpOrigin(current.endpoint)) {
    settings.apiKey = current.apiKey;
  }
  return settings;
}
