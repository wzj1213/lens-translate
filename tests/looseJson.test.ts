import { describe, expect, it } from "vitest";
import { extractTextContent, normalizeTranslatedItems, parseLooseJson } from "@shared/looseJson";

describe("extractTextContent", () => {
  it("reads OpenAI chat content", () => {
    expect(extractTextContent({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
  });
  it("reads legacy text and responses-API output", () => {
    expect(extractTextContent({ choices: [{ text: "yo" }] })).toBe("yo");
    expect(extractTextContent({ output_text: "out" })).toBe("out");
    expect(extractTextContent({ output: [{ content: [{ text: "a" }, { text: "b" }] }] })).toBe("a\nb");
  });
  it("reads Anthropic Messages content blocks", () => {
    expect(extractTextContent({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
    expect(extractTextContent({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("ab");
  });
});

describe("parseLooseJson", () => {
  it("parses plain JSON", () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips markdown fences", () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("extracts JSON embedded in prose", () => {
    expect(parseLooseJson('Sure! {"items":[]} done')).toEqual({ items: [] });
  });
  it("throws on non-JSON", () => {
    expect(() => parseLooseJson("no json here")).toThrow();
  });
});

describe("normalizeTranslatedItems", () => {
  it("normalizes the canonical items shape", () => {
    const out = normalizeTranslatedItems({ items: [{ id: "a", translated: "x" }] });
    expect(out).toEqual([{ id: "a", translated: "x" }]);
  });
  it("accepts alternate value keys and a bare array", () => {
    expect(normalizeTranslatedItems([{ id: "a", translation: "x" }])).toEqual([{ id: "a", translated: "x" }]);
    expect(normalizeTranslatedItems([{ id: "b", text: "y" }])).toEqual([{ id: "b", translated: "y" }]);
  });
  it("drops ids not in the allow-list", () => {
    const allowed = new Set(["a"]);
    const out = normalizeTranslatedItems({ items: [{ id: "a", translated: "x" }, { id: "evil", translated: "z" }] }, allowed);
    expect(out).toEqual([{ id: "a", translated: "x" }]);
  });
  it("ignores empty translations", () => {
    expect(normalizeTranslatedItems({ items: [{ id: "a", translated: "" }] })).toEqual([]);
  });
});
