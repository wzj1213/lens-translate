import { DEFAULT_SETTINGS, PROVIDER_PRESETS, TARGET_LANGUAGES } from "@shared/constants";
import { applyI18n, t } from "@shared/i18n";
import { httpOrigin } from "@shared/endpoint";
import { exportSettings, importSettings } from "./backup";
import { sendToRuntime } from "@shared/messaging";
import { loadSettings, normalizeSettings, saveSettings } from "@shared/settings";
import { removeSiteRule, upsertSiteRule } from "@shared/siteRules";
import type { CacheStatsResponse, ProviderId, Settings, SiteRule, SiteRuleMode, ThemeMode } from "@shared/types";

const form = document.getElementById("settingsForm") as HTMLFormElement;
const statusEl = document.getElementById("status") as HTMLElement;
let currentRules: SiteRule[] = [];
let keyOrigin = "";

function $(id: string): HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement {
  return document.getElementById(id) as never;
}

document.addEventListener("DOMContentLoaded", init);

async function init(): Promise<void> {
  applyI18n();
  populateProviders();
  populateDatalist("langList", TARGET_LANGUAGES);

  const settings = await loadSettings();
  currentRules = settings.siteRules;
  fillForm(settings);
  applyDocTheme(settings.theme);
  renderRules();
  void refreshCacheStats();

  setupNav();
  form.addEventListener("submit", onSave);
  $("provider").addEventListener("change", onProviderChange);
  $("endpoint").addEventListener("change", syncKeyOrigin);
  $("apiKey").addEventListener("input", () => { keyOrigin = httpOrigin($("endpoint").value); });
  $("theme").addEventListener("change", () => applyDocTheme($("theme").value as ThemeMode));
  document.getElementById("testButton")!.addEventListener("click", onTest);
  document.getElementById("clearCache")!.addEventListener("click", onClearCache);
  document.getElementById("addRule")!.addEventListener("click", onAddRule);
  document.getElementById("exportBtn")!.addEventListener("click", onExport);
  document.getElementById("importBtn")!.addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", onImport);
}

function populateProviders(): void {
  const select = $("provider");
  select.innerHTML = "";
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    select.append(new Option(preset.name, preset.id));
  }
  select.append(new Option("Custom", "custom"));
}

function populateDatalist(id: string, values: readonly string[]): void {
  const list = document.getElementById(id) as HTMLDataListElement;
  list.innerHTML = "";
  for (const value of values) list.append(new Option(value));
}

function onProviderChange(): void {
  const id = $("provider").value as ProviderId;
  const preset = id === "custom" ? null : PROVIDER_PRESETS[id];
  if (preset) {
    $("protocol").value = preset.protocol;
    $("endpoint").value = preset.endpoint;
    if (!$("model").value || !preset.models.includes($("model").value)) {
      $("model").value = preset.models[0] ?? "";
    }
    populateDatalist("modelList", preset.models);
  }
  // "custom" keeps whatever protocol the user picked.
  syncKeyOrigin();
}

function syncKeyOrigin(): void {
  const origin = httpOrigin($("endpoint").value);
  if (keyOrigin && keyOrigin !== origin) $("apiKey").value = "";
  keyOrigin = origin;
}

function fillForm(settings: Settings): void {
  keyOrigin = httpOrigin(settings.endpoint);
  for (const [key, value] of Object.entries(settings)) {
    if (key === "siteRules") continue;
    const input = form.elements.namedItem(key) as HTMLInputElement | null;
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = String(value);
  }
  const preset = Object.values(PROVIDER_PRESETS).find((p) => p.id === settings.provider);
  populateDatalist("modelList", preset?.models ?? []);
  updateSetupHint(settings);
}

function readForm(): Record<string, unknown> {
  syncKeyOrigin();
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === "siteRules") continue;
    const input = form.elements.namedItem(key) as HTMLInputElement | null;
    if (!input) continue;
    data[key] = input.type === "checkbox" ? input.checked : input.value;
  }
  data.siteRules = currentRules;
  return data;
}

async function onSave(event: Event): Promise<void> {
  event.preventDefault();
  // Preserve preferences managed by the popup, including per-origin selection rules.
  const settings = normalizeSettings({ ...(await loadSettings()), ...readForm() });
  await saveSettings(settings);
  updateSetupHint(settings);
  applyDocTheme(settings.theme);
  setStatus(t("statusSaved"), "success");
}

async function onTest(): Promise<void> {
  const button = document.getElementById("testButton") as HTMLButtonElement;
  const settings = normalizeSettings(readForm() as unknown as Partial<Settings>);
  button.disabled = true;
  setStatus(t("statusTesting"), "info");
  try {
    const response = await sendToRuntime<{ ok: boolean; result?: string; error?: string }>({
      type: "TEST_CONNECTION",
      settings,
    });
    if (!response?.ok) throw new Error(response?.error || "Test failed.");
    setStatus(t("testOk", response.result ?? ""), "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Test failed.", "error");
  } finally {
    button.disabled = false;
  }
}

async function refreshCacheStats(): Promise<void> {
  const statsEl = document.getElementById("cacheStats")!;
  try {
    const response = await sendToRuntime<CacheStatsResponse>({ type: "GET_CACHE_STATS" });
    if (response?.ok) statsEl.textContent = t("cacheStats", [String(response.count), formatBytes(response.bytes)]);
  } catch {
    statsEl.textContent = "";
  }
}

async function onClearCache(): Promise<void> {
  await sendToRuntime({ type: "CLEAR_CACHE" });
  setStatus(t("cacheCleared"), "success");
  void refreshCacheStats();
}

// --- Per-site rules ---

function renderRules(): void {
  const container = document.getElementById("siteRules")!;
  container.innerHTML = "";
  if (!currentRules.length) {
    const empty = document.createElement("div");
    empty.className = "site-empty";
    empty.textContent = t("sitesEmpty");
    container.append(empty);
    return;
  }
  for (const rule of currentRules) {
    const row = document.createElement("div");
    row.className = "site-rule";
    const host = document.createElement("span");
    host.className = "host";
    host.textContent = rule.host;

    const select = document.createElement("select");
    for (const [value, label] of [["auto", t("ruleAuto")], ["always", t("ruleAlways")], ["never", t("ruleNever")]] as const) {
      const opt = new Option(label, value);
      if (value === rule.mode) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener("change", () => {
      currentRules = upsertSiteRule(currentRules, rule.host, select.value as SiteRuleMode);
      void persistRules();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn secondary small";
    remove.textContent = t("ruleRemove");
    remove.addEventListener("click", () => {
      currentRules = removeSiteRule(currentRules, rule.host);
      renderRules();
      void persistRules();
    });

    row.append(host, select, remove);
    container.append(row);
  }
}

function onAddRule(): void {
  const host = $("ruleHost").value.trim();
  if (!host) return;
  const mode = ($("ruleMode").value as SiteRuleMode) || "auto";
  currentRules = upsertSiteRule(currentRules, host, mode);
  $("ruleHost").value = "";
  renderRules();
  void persistRules();
}

async function persistRules(): Promise<void> {
  const stored = await loadSettings();
  await saveSettings(normalizeSettings({ ...stored, siteRules: currentRules }));
}

// --- Import / export ---

function onExport(): void {
  const includeKey = $("exportKey").checked;
  void loadSettings().then((settings) => {
    const blob = new Blob([JSON.stringify(exportSettings(settings, includeKey), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lens-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function onImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const settings = importSettings(JSON.parse(await file.text()), await loadSettings());
    await saveSettings(settings);
    currentRules = settings.siteRules;
    fillForm(settings);
    applyDocTheme(settings.theme);
    renderRules();
    setStatus(t("importOk"), "success");
  } catch {
    setStatus(t("importFail"), "error");
  }
}

// --- Helpers ---

function updateSetupHint(settings: Settings): void {
  const banner = document.getElementById("setupHint") as HTMLElement;
  const configured = Boolean(settings.endpoint);
  banner.hidden = configured;
  if (!configured) banner.textContent = t("setupHint");
}

function applyDocTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(message: string, tone: "info" | "success" | "error"): void {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

/**
 * 左侧导航切面板。
 *
 * 分区只是显示层的事 —— 所有 input 仍在同一个 <form> 里，
 * fillForm / readForm 不受影响（隐藏的面板里的字段照样被读写）。
 */
const NAV_KEY = "lensOptionsTab";

function setupNav(): void {
  const nav = document.getElementById("sideNav");
  if (!nav) return;
  const items = [...nav.querySelectorAll<HTMLButtonElement>(".nav-item")];
  const panels = [...document.querySelectorAll<HTMLElement>(".panel")];

  const show = (target: string): void => {
    const hit = panels.some((p) => p.dataset.panel === target);
    const id = hit ? target : (items[0]?.dataset.target ?? "");
    for (const p of panels) p.classList.toggle("is-active", p.dataset.panel === id);
    for (const b of items) b.setAttribute("aria-current", String(b.dataset.target === id));
    try {
      sessionStorage.setItem(NAV_KEY, id);
    } catch {
      /* 隐私模式下可能不可用 */
    }
  };

  for (const b of items) {
    b.addEventListener("click", () => show(b.dataset.target ?? ""));
  }
  let initial = "";
  try {
    initial = sessionStorage.getItem(NAV_KEY) ?? "";
  } catch {
    /* ignore */
  }
  show(initial || (items[0]?.dataset.target ?? ""));
}
