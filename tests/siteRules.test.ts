import { describe, expect, it } from "vitest";
import {
  isAutoOnFor,
  matchPerSiteRule,
  normalizeHost,
  removeSiteRule,
  setAutoForHost,
  upsertSiteRule,
} from "@shared/siteRules";
import type { SiteRule } from "@shared/types";

describe("normalizeHost", () => {
  it("strips scheme, path and port", () => {
    expect(normalizeHost("https://Sub.Example.com:443/path")).toBe("sub.example.com");
  });
});

describe("matchPerSiteRule", () => {
  const rules: SiteRule[] = [
    { host: "example.com", mode: "auto" },
    { host: "*.example.com", mode: "always" },
    { host: "docs.example.com", mode: "never" },
  ];

  it("prefers an exact host match", () => {
    expect(matchPerSiteRule(rules, "docs.example.com")).toBe("never");
  });
  it("falls back to a wildcard match", () => {
    expect(matchPerSiteRule(rules, "blog.example.com")).toBe("always");
  });
  it("matches a parent domain rule", () => {
    expect(matchPerSiteRule([{ host: "example.com", mode: "always" }], "a.b.example.com")).toBe("always");
  });
  it("returns null when nothing matches", () => {
    expect(matchPerSiteRule(rules, "other.org")).toBeNull();
  });
});

describe("upsert / remove", () => {
  it("replaces an existing host and keeps sorted order", () => {
    let rules: SiteRule[] = [{ host: "b.com", mode: "auto" }];
    rules = upsertSiteRule(rules, "a.com", "never");
    rules = upsertSiteRule(rules, "b.com", "always");
    expect(rules).toEqual([
      { host: "a.com", mode: "never" },
      { host: "b.com", mode: "always" },
    ]);
  });
  it("removes by host", () => {
    const rules = removeSiteRule([{ host: "a.com", mode: "never" }], "A.com");
    expect(rules).toEqual([]);
  });
});

describe("per-site auto-translate", () => {
  it("falls back to the global default when no rule matches", () => {
    expect(isAutoOnFor({ siteRules: [], autoTranslateEnabled: true }, "a.com")).toBe(true);
    expect(isAutoOnFor({ siteRules: [], autoTranslateEnabled: false }, "a.com")).toBe(false);
  });

  it("lets a site rule beat the global default in BOTH directions", () => {
    const off: SiteRule[] = [{ host: "a.com", mode: "never" }];
    expect(isAutoOnFor({ siteRules: off, autoTranslateEnabled: true }, "a.com")).toBe(false);
    const on: SiteRule[] = [{ host: "a.com", mode: "always" }];
    expect(isAutoOnFor({ siteRules: on, autoTranslateEnabled: false }, "a.com")).toBe(true);
  });

  it("turning auto off writes a rule that actually turns it off", () => {
    const settings = { siteRules: [] as SiteRule[], autoTranslateEnabled: true };
    const next = setAutoForHost(settings, "a.com", false);
    expect(isAutoOnFor({ ...settings, siteRules: next }, "a.com")).toBe(false);
    // and does not touch other sites
    expect(isAutoOnFor({ ...settings, siteRules: next }, "b.com")).toBe(true);
  });

  it("turning auto on overrides an inherited parent-domain 'never'", () => {
    const settings = { siteRules: [{ host: "example.com", mode: "never" }] as SiteRule[], autoTranslateEnabled: false };
    const next = setAutoForHost(settings, "docs.example.com", true);
    expect(isAutoOnFor({ ...settings, siteRules: next }, "docs.example.com")).toBe(true);
    expect(isAutoOnFor({ ...settings, siteRules: next }, "www.example.com")).toBe(false);
  });

  it("drops the explicit rule when the inherited value already matches", () => {
    const settings = { siteRules: [{ host: "a.com", mode: "always" }] as SiteRule[], autoTranslateEnabled: true };
    expect(setAutoForHost(settings, "a.com", true)).toEqual([]);
  });

  it("is idempotent across repeated toggles", () => {
    let rules: SiteRule[] = [];
    const base = { autoTranslateEnabled: false };
    for (let i = 0; i < 4; i += 1) {
      rules = setAutoForHost({ ...base, siteRules: rules }, "a.com", true);
      expect(isAutoOnFor({ ...base, siteRules: rules }, "a.com")).toBe(true);
      rules = setAutoForHost({ ...base, siteRules: rules }, "a.com", false);
      expect(isAutoOnFor({ ...base, siteRules: rules }, "a.com")).toBe(false);
    }
  });
});
