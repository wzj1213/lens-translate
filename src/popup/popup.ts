import { applyI18n, t } from "@shared/i18n";
import { loadSettings, normalizeSettings, saveSettings } from "@shared/settings";
import { isAutoOnFor, setAutoForHost } from "@shared/siteRules";
import { selectionModeFor, selectionOrigin, setSelectionModeFor } from "@shared/selectionRules";
import type { ContentCommand, DisplayMode, PageStatus, SelectionToolbarMode, Settings, ThemeMode } from "@shared/types";

const statusEl = byId("status");

const COMMAND_BUTTONS: Record<string, ContentCommand> = {
  translatePage: "TOGGLE_PAGE",
  translateSelection: "TRANSLATE_SELECTION",
  restoreOriginal: "RESTORE_ORIGINAL",
  stopTranslation: "STOP_TRANSLATION",
  showSelectionToolbar: "SHOW_SELECTION_TOOLBAR",
};

let settings: Settings;
let host = "";
let tab: chrome.tabs.Tab | undefined;
let savingSelectionMode = false;

document.addEventListener("DOMContentLoaded", init);

async function init(): Promise<void> {
  applyI18n();
  settings = await loadSettings();
  applyDocTheme(settings.theme);

  tab = await getActiveTab();
  host = hostFromUrl(tab?.url);
  render();

  if (!settings.endpoint) setStatus(t("popupNeedSetup"), "info");

  for (const [id, command] of Object.entries(COMMAND_BUTTONS)) {
    byId(id).addEventListener("click", () => void sendCommand(command));
  }
  byId("toggleAuto").addEventListener("click", () => void toggleAuto());
  byId("toggleBubble").addEventListener("click", () => void toggleBubble());
  byId("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  for (const button of modeButtons()) {
    button.addEventListener("click", () => void setDisplayMode(button.dataset.mode as DisplayMode));
  }
  for (const button of selectionModeButtons()) {
    button.addEventListener("click", () => void setSelectionMode(button.dataset.selectionMode as SelectionToolbarMode));
  }

  void refreshPageState();
}

/** Paint every control from the current settings — one render path, no drift. */
function render(): void {
  const auto = host ? isAutoOnFor(settings, host) : settings.autoTranslateEnabled;
  setSwitch(byId("toggleAuto"), auto);
  byId("autoScope").textContent = host || t("thisSite");
  byId("toggleAuto").toggleAttribute("disabled", !host);

  setSwitch(byId("toggleBubble"), settings.floatingBubbleEnabled);

  for (const button of modeButtons()) {
    const active = button.dataset.mode === settings.displayMode;
    button.dataset.active = active ? "true" : "false";
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }

  const origin = selectionOrigin(tab?.url);
  const selectionMode = selectionModeFor(settings, origin);
  byId("selectionScope").textContent = origin || t("unsupportedPage");
  for (const button of selectionModeButtons()) {
    const active = button.dataset.selectionMode === selectionMode;
    button.dataset.active = String(active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !origin || savingSelectionMode;
  }
  byId("selectionHint").textContent = t({
    auto: "selectionToolbarAutoHint",
    manual: "selectionToolbarManualHint",
    off: "selectionToolbarOffHint",
  }[selectionMode]);
  byId("showSelectionToolbar").toggleAttribute("disabled", !origin || selectionMode === "off" || savingSelectionMode);
}

/** Reflect what the page is actually showing (translated / busy) on the CTA. */
async function refreshPageState(): Promise<void> {
  if (!tab?.id || !/^https?:/i.test(tab.url ?? "")) return;
  try {
    const status = (await chrome.tabs.sendMessage(tab.id, {
      type: "LENS_COMMAND",
      command: "GET_STATUS",
    })) as (PageStatus & { ok: boolean }) | undefined;
    if (!status?.ok) return;
    const cta = byId("translatePage");
    if (status.busy) cta.textContent = t("translating");
    else if (status.active) cta.textContent = t("showOriginal");
    else cta.textContent = t("translatePage");
  } catch {
    // No content script on this page yet — the CTA keeps its default label.
  }
}

async function sendCommand(command: ContentCommand): Promise<void> {
  setStatus(t("statusSending"), "info");
  try {
    if (!tab?.id || !/^https?:/i.test(tab.url ?? "")) throw new Error(t("unsupportedPage"));
    const response = await sendToTab(tab.id, command);
    if (!response?.ok) throw new Error(response?.error || t("toastFailed"));
    setStatus(t("statusReady"), "success");
    window.close();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("toastFailed"), "error");
  }
}

async function sendToTab(tabId: number, command: ContentCommand): Promise<{ ok: boolean; error?: string }> {
  const message = { type: "LENS_COMMAND", command };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content_script.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

/**
 * Auto-translate is scoped to the site in the active tab. It writes a per-site
 * rule, which beats both the global default and any broader rule — so the switch
 * always reflects, and always changes, what this site actually does.
 */
async function toggleAuto(): Promise<void> {
  if (!host) return;
  const next = !isAutoOnFor(settings, host);
  await update({ siteRules: setAutoForHost(settings, host, next) });
  setStatus(t(next ? "autoOnHost" : "autoOffHost", [host]), next ? "success" : "info");
}

async function toggleBubble(): Promise<void> {
  const next = !settings.floatingBubbleEnabled;
  await update({ floatingBubbleEnabled: next });
  setStatus(t(next ? "floatingBubble" : "disableBubble"), next ? "success" : "info");
}

async function setDisplayMode(mode: DisplayMode): Promise<void> {
  if (!mode || mode === settings.displayMode) return;
  await update({ displayMode: mode });
  // Already-translated pages re-render in place; no re-translation needed.
  setStatus(t(mode === "bilingual" ? "displayBilingual" : "displayReplace"), "success");
}

async function setSelectionMode(mode: SelectionToolbarMode): Promise<void> {
  const origin = selectionOrigin(tab?.url);
  if (!origin || savingSelectionMode) return;
  savingSelectionMode = true;
  render();
  try {
    const latest = await loadSettings();
    const next = normalizeSettings({ ...latest, selectionToolbarRules: setSelectionModeFor(latest, origin, mode) });
    await saveSettings(next);
    settings = next;
    setStatus(t("selectionToolbarSaved"), "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("toastFailed"), "error");
  } finally {
    savingSelectionMode = false;
    render();
  }
}

/** Re-read before writing so a concurrent options-page save is not clobbered. */
async function update(patch: Partial<Settings>): Promise<void> {
  const latest = await loadSettings();
  settings = normalizeSettings({ ...latest, ...patch });
  await saveSettings(settings);
  render();
}

function modeButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("#displayMode button")];
}

function selectionModeButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("#selectionToolbarMode button")];
}

function setSwitch(el: HTMLElement, on: boolean): void {
  el.dataset.on = on ? "true" : "false";
  el.setAttribute("aria-checked", on ? "true" : "false");
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function hostFromUrl(url: string | undefined): string {
  try {
    if (!url || !/^https?:/i.test(url)) return "";
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function applyDocTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
}

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function setStatus(message: string, tone: "info" | "success" | "error"): void {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}
