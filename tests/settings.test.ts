import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/constants";
import { normalizeSettings, publicSettings } from "@shared/settings";

describe("normalizeSettings", () => {
  it("fills defaults from an empty object", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps numeric ranges", () => {
    const s = normalizeSettings({ maxConcurrency: 99, temperature: 9, batchMaxItems: 1, requestTimeoutMs: 1 });
    expect(s.maxConcurrency).toBe(24);
    expect(s.temperature).toBe(2);
    expect(s.batchMaxItems).toBe(4);
    expect(s.requestTimeoutMs).toBe(8000);
  });

  it("falls back invalid enums to defaults", () => {
    const s = normalizeSettings({
      provider: "bogus" as never,
      displayMode: "weird" as never,
      translationColor: "rainbow" as never,
      theme: "neon" as never,
    });
    expect(s.provider).toBe("custom");
    expect(s.displayMode).toBe("bilingual");
    expect(s.translationColor).toBe("green");
    expect(s.theme).toBe("system");
  });

  it("coerces string numbers (from form inputs)", () => {
    const s = normalizeSettings({ maxSegments: "400" as never, cacheTtlDays: "10" as never });
    expect(s.maxSegments).toBe(400);
    expect(s.cacheTtlDays).toBe(10);
  });

  it("sanitizes site rules and drops bad entries", () => {
    const s = normalizeSettings({
      siteRules: [
        { host: "Example.com", mode: "always" },
        { host: "", mode: "always" },
        { host: "x.com", mode: "bogus" },
        { host: "example.com", mode: "never" },
      ] as never,
    });
    expect(s.siteRules).toEqual([{ host: "example.com", mode: "always" }]);
  });

  it("only restricts prefetch to allowed steps", () => {
    expect(normalizeSettings({ autoTranslatePrefetchScreens: 1.5 }).autoTranslatePrefetchScreens).toBe(1.5);
    expect(normalizeSettings({ autoTranslatePrefetchScreens: 3 }).autoTranslatePrefetchScreens).toBe(
      DEFAULT_SETTINGS.autoTranslatePrefetchScreens,
    );
  });
});

describe("publicSettings", () => {
  it("never includes the API key or endpoint", () => {
    const pub = publicSettings(normalizeSettings({ apiKey: "sk-secret", endpoint: "https://x" }));
    expect(pub).not.toHaveProperty("apiKey");
    expect(pub).not.toHaveProperty("endpoint");
    expect(JSON.stringify(pub)).not.toContain("sk-secret");
  });
});

it("migrates existing endpoints and keeps the saved provider when switching engines", () => {
  expect(normalizeSettings({}).engine).toBe("chrome");
  const old = normalizeSettings({ endpoint: "https://models.example/v1", apiKey: "test-key" });
  expect(old.engine).toBe("model");
  const local = normalizeSettings({ ...old, engine: "chrome" });
  expect(local).toMatchObject({ engine: "chrome", endpoint: old.endpoint, apiKey: old.apiKey });
});
