import { describe, expect, it } from "vitest";
import { isPrivateHost, normalizeEndpoint, validateEndpointUrl } from "@shared/endpoint";

describe("normalizeEndpoint", () => {
  it("returns empty for blank input", () => {
    expect(normalizeEndpoint("")).toBe("");
    expect(normalizeEndpoint("   ")).toBe("");
  });

  it("appends /v1/chat/completions to a bare host", () => {
    expect(normalizeEndpoint("https://api.example.com")).toBe("https://api.example.com/v1/chat/completions");
  });

  it("appends /chat/completions after a version segment", () => {
    expect(normalizeEndpoint("https://api.example.com/v1")).toBe("https://api.example.com/v1/chat/completions");
    expect(normalizeEndpoint("https://api.example.com/v3")).toBe("https://api.example.com/v3/chat/completions");
  });

  it("passes through a full path unchanged", () => {
    const url = "https://api.example.com/v1/chat/completions";
    expect(normalizeEndpoint(url)).toBe(url);
  });

  it("strips trailing slashes", () => {
    expect(normalizeEndpoint("https://api.example.com/v1/")).toBe("https://api.example.com/v1/chat/completions");
  });

  it("handles the Gemini openai-compat suffix", () => {
    expect(normalizeEndpoint("https://x/v1beta/openai")).toBe("https://x/v1beta/openai/chat/completions");
  });

  it("resolves the Anthropic Messages path when protocol is anthropic", () => {
    expect(normalizeEndpoint("https://api.anthropic.com", "anthropic")).toBe("https://api.anthropic.com/v1/messages");
    expect(normalizeEndpoint("https://api.anthropic.com/v1", "anthropic")).toBe("https://api.anthropic.com/v1/messages");
    expect(normalizeEndpoint("https://api.anthropic.com/v1/messages", "anthropic")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(normalizeEndpoint("https://proxy.example.com/", "anthropic")).toBe("https://proxy.example.com/v1/messages");
    expect(normalizeEndpoint("", "anthropic")).toBe("");
  });
});

describe("isPrivateHost", () => {
  it("flags loopback and private ranges", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "::1", "foo.local"]) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });
  it("allows public hosts", () => {
    for (const host of ["api.openai.com", "8.8.8.8", "172.15.0.1", "example.com"]) {
      expect(isPrivateHost(host)).toBe(false);
    }
  });
  it("catches IPv4-mapped IPv6 and the unspecified address", () => {
    expect(isPrivateHost(new URL("http://[::ffff:127.0.0.1]").hostname)).toBe(true);
    expect(isPrivateHost(new URL("http://[::]/").hostname)).toBe(true);
  });
});

describe("validateEndpointUrl", () => {
  it("rejects non-http schemes", () => {
    expect(validateEndpointUrl("ftp://x.com").ok).toBe(false);
  });
  it("rejects private hosts by default", () => {
    expect(validateEndpointUrl("http://localhost:8080/v1/chat/completions").ok).toBe(false);
  });
  it("accepts public https", () => {
    expect(validateEndpointUrl("https://api.openai.com/v1/chat/completions").ok).toBe(true);
  });
  it("allows local endpoints when allowPrivate is set (local LLM servers)", () => {
    expect(validateEndpointUrl("http://localhost:11434/v1/chat/completions", { allowPrivate: true }).ok).toBe(true);
    expect(validateEndpointUrl("ftp://localhost", { allowPrivate: true }).ok).toBe(false);
  });
});
