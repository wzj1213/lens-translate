import { describe, expect, it } from "vitest";
import { exportSettings, importSettings } from "../src/options/backup";
import { normalizeSettings } from "@shared/settings";

const settings = normalizeSettings({ endpoint: "https://models.example/v1", apiKey: "fixture-key" });

describe("settings backups", () => {
  it("omits the key by default and can explicitly include it in a private backup", () => {
    expect(exportSettings(settings, false)).not.toHaveProperty("apiKey");
    expect(exportSettings(settings, true).apiKey).toBe(settings.apiKey);
  });

  it("retains the existing key when restoring preferences for the same service", () => {
    const backup = { ...exportSettings(settings, false), endpoint: "https://models.example/v2" };
    expect(importSettings(backup, settings).apiKey).toBe(settings.apiKey);
  });

  it("never reuses the old key across origins and accepts older backups with explicit keys", () => {
    const backup = { ...exportSettings(settings, false), endpoint: "https://other.example/v1" };
    expect(importSettings(backup, settings).apiKey).toBe("");
    expect(importSettings({ ...backup, apiKey: "imported-key" }, settings).apiKey).toBe("imported-key");
    expect(importSettings({ ...backup, apiKey: "" }, settings).apiKey).toBe("");
  });

  it("rejects unrelated JSON without replacing preferences", () => {
    for (const invalid of [null, [], "preferences", {}, { unrelated: true }]) {
      expect(() => importSettings(invalid, settings)).toThrow();
    }
  });
});
