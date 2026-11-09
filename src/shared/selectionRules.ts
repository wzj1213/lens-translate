import { httpOrigin as selectionOrigin } from "./endpoint";
import type { SelectionToolbarMode, SelectionToolbarRule, Settings } from "./types";

export { selectionOrigin };

const MODES: readonly SelectionToolbarMode[] = ["auto", "manual", "off"];

export function sanitizeSelectionToolbarRules(value: unknown): SelectionToolbarRule[] {
  if (!Array.isArray(value)) return [];
  const rules: SelectionToolbarRule[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry.origin !== "string" || !MODES.includes(entry.mode)) continue;
    const origin = selectionOrigin(entry.origin);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    rules.push({ origin, mode: entry.mode });
  }
  return rules;
}

export function selectionModeFor(
  settings: Pick<Settings, "selectionToolbarRules">,
  url: string | undefined,
): SelectionToolbarMode {
  const origin = selectionOrigin(url);
  return settings.selectionToolbarRules.find((rule) => rule.origin === origin)?.mode ?? "auto";
}

export function setSelectionModeFor(
  settings: Pick<Settings, "selectionToolbarRules">,
  url: string,
  mode: SelectionToolbarMode,
): SelectionToolbarRule[] {
  const rules = sanitizeSelectionToolbarRules(settings.selectionToolbarRules);
  const origin = selectionOrigin(url);
  if (!origin || !MODES.includes(mode)) return rules;
  const remaining = rules.filter((rule) => rule.origin !== origin);
  // Auto is the default, so it also clears an explicit exception for this site.
  return mode === "auto" ? remaining : [...remaining, { origin, mode }];
}
