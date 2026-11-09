import { describe, expect, it } from "vitest";
import { normalizeSettings } from "@shared/settings";
import { sanitizeSelectionToolbarRules, selectionModeFor, selectionOrigin, setSelectionModeFor } from "@shared/selectionRules";

const site = "http://example.test:8080";

describe("selection toolbar site rules", () => {
  it("matches an origin including scheme and port, but not a page path", () => {
    const settings = normalizeSettings({ selectionToolbarRules: [{ origin: site, mode: "manual" }] });
    expect(selectionModeFor(settings, `${site}/chapter/1`)).toBe("manual");
    expect(selectionModeFor(settings, "http://example.test:8081")).toBe("auto");
    expect(selectionModeFor(settings, "https://example.test:8080")).toBe("auto");
    expect(selectionModeFor(settings, "http://sub.example.test:8080")).toBe("auto");
  });

  it("normalizes origins and ignores invalid or duplicate imported rules", () => {
    expect(sanitizeSelectionToolbarRules([
      null,
      { origin: "https://Example.test:443/chapter?q=1", mode: "off" },
      { origin: "https://example.test", mode: "manual" },
      { origin: site, mode: "bogus" },
      { origin: "chrome://extensions", mode: "off" },
      { origin: "https://user:password@example.test", mode: "manual" },
    ])).toEqual([{ origin: "https://example.test", mode: "off" }]);
    expect(selectionOrigin(undefined)).toBe("");
    expect(selectionOrigin("file:///tmp/page.html")).toBe("");
    expect(sanitizeSelectionToolbarRules({})).toEqual([]);
  });

  it("updates one application without changing rules for others", () => {
    const settings = normalizeSettings({ selectionToolbarRules: [
      { origin: site, mode: "off" },
      { origin: "http://example.test:8081", mode: "off" },
    ] });
    const next = setSelectionModeFor(settings, `${site}/book`, "manual");
    expect(next).toEqual([
      { origin: "http://example.test:8081", mode: "off" },
      { origin: site, mode: "manual" },
    ]);
    expect(setSelectionModeFor({ selectionToolbarRules: next }, site, "auto"))
      .toEqual([{ origin: "http://example.test:8081", mode: "off" }]);
    expect(settings.selectionToolbarRules[0]?.mode).toBe("off");
  });

  it("keeps legacy settings and unrelated preferences when adding a rule", () => {
    const legacy = normalizeSettings({ model: "existing-model", sourceSkip: false, siteRules: [{ host: "example.test", mode: "never" }] });
    expect(selectionModeFor(legacy, site)).toBe("auto");
    const next = normalizeSettings({ ...legacy, selectionToolbarRules: setSelectionModeFor(legacy, site, "manual") });
    expect(next.model).toBe("existing-model");
    expect(next.sourceSkip).toBe(false);
    expect(next.siteRules).toEqual(legacy.siteRules);
    expect(selectionModeFor(next, site)).toBe("manual");
  });
});
