import { describe, expect, it } from "vitest";
import { createCacheKey } from "@shared/cacheKey";
import { CACHE_PREFIX } from "@shared/constants";

const base = { endpoint: "https://api.example.com", model: "m1", targetLang: "简体中文" };

describe("createCacheKey", () => {
  it("is stable for equivalent endpoint forms", async () => {
    const a = await createCacheKey({ ...base, endpoint: "https://api.example.com" }, "Hello world");
    const b = await createCacheKey({ ...base, endpoint: "https://api.example.com/v1/chat/completions" }, "Hello world");
    expect(a).toBe(b);
  });

  it("ignores surrounding whitespace in the text", async () => {
    const a = await createCacheKey(base, "Hello   world");
    const b = await createCacheKey(base, "  Hello world ");
    expect(a).toBe(b);
  });

  it("normalizes the path using the selected protocol", async () => {
    const anthropic = { ...base, protocol: "anthropic" } as const;
    const key = await createCacheKey(anthropic, "Hello");
    expect(key).toBe(await createCacheKey({ ...anthropic, endpoint: base.endpoint + "/v1/messages" }, "Hello"));
    expect(key).not.toBe(await createCacheKey(base, "Hello"));
  });

  it("differs by model, target language and text", async () => {
    const a = await createCacheKey(base, "Hello");
    const b = await createCacheKey({ ...base, model: "m2" }, "Hello");
    const c = await createCacheKey({ ...base, targetLang: "English" }, "Hello");
    const d = await createCacheKey(base, "Goodbye");
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("is prefixed for storage scoping", async () => {
    // 断言引用常量而非硬编码字面量 —— 前缀改名时不该误报成回归
    expect(await createCacheKey(base, "x")).toMatch(
      new RegExp(`^${CACHE_PREFIX}[0-9a-f]{64}$`)
    );
  });
});

describe("glossary in the cache key", () => {
  const base = { endpoint: "https://api.example.com/v1", model: "m", targetLang: "简体中文" };

  it("keeps the same key when there is no glossary (existing caches survive)", async () => {
    const a = await createCacheKey(base, "Hello");
    const b = await createCacheKey({ ...base, glossary: "\n# only a comment\n" }, "Hello");
    expect(a).toBe(b);
  });

  it("changes the key when a glossary term changes", async () => {
    const a = await createCacheKey({ ...base, glossary: "GPU=显卡" }, "Hello");
    const b = await createCacheKey({ ...base, glossary: "GPU=图形处理器" }, "Hello");
    expect(a).not.toBe(b);
  });

  it("ignores comment/whitespace-only edits to the glossary", async () => {
    const a = await createCacheKey({ ...base, glossary: "GPU=显卡" }, "Hello");
    const b = await createCacheKey({ ...base, glossary: "# note\nGPU  =  显卡  \n" }, "Hello");
    expect(a).toBe(b);
  });
});
