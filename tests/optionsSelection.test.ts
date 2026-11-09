import html from "../src/options/options.html?raw";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeSettings } from "@shared/settings";
import { SETTINGS_KEY } from "@shared/constants";

afterEach(() => vi.unstubAllGlobals());

it("preserves rules saved by the popup while the options form was already open", async () => {
  document.documentElement.innerHTML = html;
  let saved = normalizeSettings({ model: "initial-model" });
  const set = vi.fn(async (value) => { saved = value[SETTINGS_KEY]; });
  vi.stubGlobal("chrome", {
    i18n: { getMessage: (key: string) => key },
    storage: { local: { get: vi.fn(async () => ({ [SETTINGS_KEY]: saved })), set } },
    runtime: { sendMessage: vi.fn(async () => ({ ok: true, count: 0, bytes: 0 })) },
  });
  await import("../src/options/options");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  const model = document.getElementById("model") as HTMLInputElement;
  await vi.waitFor(() => expect(model.value).toBe("initial-model"));
  saved = normalizeSettings({ ...saved, selectionToolbarRules: [{ origin: "http://example.test:8080", mode: "manual" }] });
  model.value = "updated-model";
  const form = document.getElementById("settingsForm") as HTMLFormElement;
  expect(form.checkValidity()).toBe(true);
  (document.getElementById("saveButton") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
  expect(saved.model).toBe("updated-model");
  expect(saved.selectionToolbarRules).toEqual([{ origin: "http://example.test:8080", mode: "manual" }]);
});
