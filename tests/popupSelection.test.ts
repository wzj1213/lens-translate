import html from "../src/popup/popup.html?raw";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeSettings } from "@shared/settings";
import { SETTINGS_KEY } from "@shared/constants";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("saves the popup's site mode, preserves other settings, and explicitly opens the toolbar", async () => {
  document.documentElement.innerHTML = html;
  let saved = normalizeSettings({ endpoint: "https://api.example.test", model: "configured-model", selectionToolbarRules: [
    { origin: "http://example.test:8081", mode: "off" },
  ] });
  const set = vi.fn(async (value) => { saved = value[SETTINGS_KEY]; });
  const sendMessage = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("chrome", {
    i18n: { getMessage: (key: string) => key },
    storage: { local: { get: vi.fn(async () => ({ [SETTINGS_KEY]: saved })), set } },
    tabs: { query: vi.fn(async () => [{ id: 1, url: "http://example.test:8080/book" }]), sendMessage },
    runtime: { openOptionsPage: vi.fn() },
  });
  vi.spyOn(window, "close").mockImplementation(() => {});
  await import("../src/popup/popup");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await vi.waitFor(() => expect(document.querySelector('[data-selection-mode="auto"]')?.getAttribute("aria-pressed")).toBe("true"));
  expect(document.getElementById("selectionScope")?.textContent).toBe("http://example.test:8080");

  const clickMode = async (mode: string, calls: number) => {
    (document.querySelector(`[data-selection-mode="${mode}"]`) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(calls));
    expect(document.querySelector(`[data-selection-mode="${mode}"]`)?.getAttribute("aria-pressed")).toBe("true");
  };
  await clickMode("manual", 1);
  expect(saved.selectionToolbarRules).toEqual([
    { origin: "http://example.test:8081", mode: "off" },
    { origin: "http://example.test:8080", mode: "manual" },
  ]);
  expect(saved.model).toBe("configured-model");
  (document.getElementById("showSelectionToolbar") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(1, { type: "LENS_COMMAND", command: "SHOW_SELECTION_TOOLBAR" }));
  await clickMode("off", 2);
  expect((document.getElementById("showSelectionToolbar") as HTMLButtonElement).disabled).toBe(true);
  await clickMode("auto", 3);
  expect(saved.selectionToolbarRules).toEqual([{ origin: "http://example.test:8081", mode: "off" }]);
});
