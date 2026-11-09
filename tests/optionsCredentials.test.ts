import { afterEach, expect, it, vi } from "vitest";
import html from "../src/options/options.html?raw";
import { SETTINGS_KEY } from "@shared/constants";
import { normalizeSettings } from "@shared/settings";

afterEach(() => vi.unstubAllGlobals());

it("keeps a key on same-origin edits and clears it before testing a different provider", async () => {
  document.documentElement.innerHTML = html;
  const saved = normalizeSettings({ endpoint: "https://one.example/v1", apiKey: "fixture-key" });
  const sendMessage = vi.fn(async () => ({ ok: true, count: 0, bytes: 0 }));
  vi.stubGlobal("chrome", {
    i18n: { getMessage: (key: string) => key },
    storage: { local: { get: async () => ({ [SETTINGS_KEY]: saved }) } },
    runtime: { sendMessage },
  });
  await import("../src/options/options");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  const endpoint = document.querySelector<HTMLInputElement>("#endpoint")!;
  const key = document.querySelector<HTMLInputElement>("#apiKey")!;
  const provider = document.querySelector<HTMLSelectElement>("#provider")!;
  const test = document.querySelector<HTMLButtonElement>("#testButton")!;
  await vi.waitFor(() => expect(key.value).toBe("fixture-key"));

  endpoint.value = "https://one.example/v2";
  endpoint.dispatchEvent(new Event("change"));
  expect(key.value).toBe("fixture-key");
  provider.value = "deepseek";
  provider.dispatchEvent(new Event("change"));
  expect(key.value).toBe("");
  key.value = "new-fixture-key";
  key.dispatchEvent(new Event("input"));
  endpoint.value = "https://two.example/v1";
  test.click();
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "TEST_CONNECTION", settings: expect.objectContaining({ apiKey: "", endpoint: endpoint.value }),
  })));
});
