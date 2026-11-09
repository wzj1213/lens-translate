import { describe, expect, it } from "vitest";
import { buildBatchMessages, buildSingleMessages, parseGlossary, toAnthropicMessages } from "@shared/prompt";

describe("parseGlossary", () => {
  it("parses = and => and full-width separators, ignoring comments", () => {
    const entries = parseGlossary("GPU=显卡\ncache => 缓存\n# note\nfoo：bar");
    expect(entries).toEqual([
      { from: "GPU", to: "显卡" },
      { from: "cache", to: "缓存" },
      { from: "foo", to: "bar" },
    ]);
  });
  it("returns empty for blank input", () => {
    expect(parseGlossary("")).toEqual([]);
    expect(parseGlossary(undefined)).toEqual([]);
  });
});

describe("buildBatchMessages", () => {
  it("requests JSON, names the target language and carries every id", () => {
    const messages = buildBatchMessages(
      [
        { id: "s1", text: "Hello" },
        { id: "s2", text: "World" },
      ],
      { targetLang: "简体中文" },
    );
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("简体中文");
    expect(messages[0].content).toContain('{"items":');
    const user = JSON.parse(messages[1].content);
    expect(user.items.map((i: { id: string }) => i.id)).toEqual(["s1", "s2"]);
  });

  it("injects glossary terms when provided", () => {
    const messages = buildBatchMessages([{ id: "a", text: "x" }], { targetLang: "English", glossary: "GPU=显卡" });
    expect(messages[0].content).toContain("GPU => 显卡");
  });
});

describe("buildSingleMessages", () => {
  it("asks for plain-text output in the target language", () => {
    const messages = buildSingleMessages("Bonjour", { targetLang: "English" });
    expect(messages[0].content).toContain("English");
    expect(messages[1].content).toBe("Bonjour");
  });
});

describe("toAnthropicMessages", () => {
  it("hoists system turns out of the messages array", () => {
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
    expect(system).toBe("be terse");
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("merges multiple system turns and leaves user/assistant order intact", () => {
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "a" },
      { role: "system", content: "b" },
      { role: "user", content: "q" },
      { role: "assistant", content: "r" },
    ]);
    expect(system).toBe("a\n\nb");
    expect(messages).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "r" },
    ]);
  });
});

describe("page context", () => {
  const items = [{ id: "1", text: "Effort matters more" }];
  const system = (options: Parameters<typeof buildBatchMessages>[1]) =>
    buildBatchMessages(items, options)[0].content;

  it("is omitted entirely when there is no context", () => {
    expect(system({ targetLang: "简体中文" })).not.toContain("taken from");
    expect(system({ targetLang: "简体中文", context: { title: "", host: "" } })).not.toContain("taken from");
  });

  it("passes the page title and host, and forbids translating them", () => {
    const out = system({
      targetLang: "简体中文",
      context: { title: "What's new in Claude Opus 5", host: "docs.claude.com" },
    });
    expect(out).toContain('page title "What\'s new in Claude Opus 5"');
    expect(out).toContain("site docs.claude.com");
    expect(out).toContain("never translate");
  });

  it("caps absurdly long titles so they cannot dominate the prompt", () => {
    const out = system({ targetLang: "简体中文", context: { title: "x".repeat(500), host: "" } });
    expect(out).toContain("x".repeat(120));
    expect(out).not.toContain("x".repeat(121));
  });
});
